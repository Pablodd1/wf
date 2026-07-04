/**
 * Hero3D — Three.js luxury watch hero scene.
 * Renders a rotating watch on a dark pedestal with cinematic lighting.
 * Loads Three.js from CDN asynchronously — never blocks initial render.
 * Falls back to gradient background if Three.js fails to load.
 */

import { useEffect, useRef, useState } from 'react';

// ─── Types ────────────────────────────────────────────────
interface ThreeJSWindow extends Window {
  THREE?: any;
}

export function Hero3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let animationId: number;
    let scene: any, camera: any, renderer: any, watchGroup: any;
    let particles: any;

    async function initThree() {
      try {
        // Load Three.js from CDN
        const THREE = await loadThreeJS();
        if (!THREE) throw new Error('Failed to load Three.js');

        const container = containerRef.current;
        if (!container) return;

        // ─── Scene ───────────────────────────────
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x050a12);
        scene.fog = new THREE.FogExp2(0x050a12, 0.00004);

        // ─── Camera ──────────────────────────────
        camera = new THREE.PerspectiveCamera(
          45,
          container.clientWidth / container.clientHeight,
          0.1,
          50
        );
        camera.position.set(0, 1.5, 5);
        camera.lookAt(0, 0.5, 0);

        // ─── Renderer ────────────────────────────
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
        });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
        container.appendChild(renderer.domElement);

        // ─── Environment Map (canvas generated) ──
        const envMap = createEnvironmentMap(THREE);
        scene.environment = envMap;

        // ─── Lighting ────────────────────────────
        // Ambient
        scene.add(new THREE.AmbientLight(0x1a2840, 0.4));

        // Key light (warm gold)
        const keyLight = new THREE.DirectionalLight(0xffd8a8, 2.5);
        keyLight.position.set(4, 3, -3);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(1024, 1024);
        keyLight.shadow.camera.near = 0.5;
        keyLight.shadow.camera.far = 15;
        keyLight.shadow.bias = -0.0002;
        scene.add(keyLight);

        // Fill light (cool blue)
        const fillLight = new THREE.DirectionalLight(0x446688, 0.4);
        fillLight.position.set(-3, 1.5, 2);
        scene.add(fillLight);

        // Rim light (white-gold)
        const rimLight = new THREE.DirectionalLight(0xffeedd, 0.5);
        rimLight.position.set(-2, 1, -3);
        scene.add(rimLight);

        // Under glow (gold)
        const underGlow = new THREE.PointLight(0xc9a44c, 0.8, 5);
        underGlow.position.set(0, -0.2, 0);
        scene.add(underGlow);

        // ─── Watch Group ─────────────────────────
        watchGroup = new THREE.Group();
        watchGroup.position.y = 0.4;

        // Pedestal (dark marble)
        const pedestalGeo = new THREE.CylinderGeometry(0.6, 0.7, 0.15, 48);
        const pedestalMat = new THREE.MeshStandardMaterial({
          color: 0x1a1a24,
          roughness: 0.5,
          metalness: 0.1,
        });
        const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
        pedestal.position.y = -0.45;
        pedestal.receiveShadow = true;
        watchGroup.add(pedestal);

        // Watch case (simplified geometry — gold cylinder + details)
        const caseGroup = new THREE.Group();

        // Main case body
        const caseGeo = new THREE.TorusGeometry(0.25, 0.08, 32, 64);
        const caseMat = new THREE.MeshPhysicalMaterial({
          color: 0xd4af37,
          roughness: 0.08,
          metalness: 0.95,
          clearcoat: 0.3,
          reflectivity: 1,
        });
        const caseRing = new THREE.Mesh(caseGeo, caseMat);
        caseRing.rotation.x = Math.PI / 2;
        caseRing.castShadow = true;
        caseGroup.add(caseRing);

        // Watch face (dial)
        const dialGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.04, 64);
        const dialMat = new THREE.MeshStandardMaterial({
          color: 0x0a0a0f,
          roughness: 0.1,
          metalness: 0.2,
        });
        const dial = new THREE.Mesh(dialGeo, dialMat);
        dial.position.y = 0;
        caseGroup.add(dial);

        // Crystal (transparent dome)
        const crystalGeo = new THREE.SphereGeometry(0.22, 48, 24, 0, Math.PI * 2, 0, Math.PI / 4);
        const crystalMat = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.02,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          transparent: true,
          opacity: 0.15,
        });
        const crystal = new THREE.Mesh(crystalGeo, crystalMat);
        crystal.position.y = 0;
        caseGroup.add(crystal);

        // Crown
        const crownGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.06, 32);
        const crown = new THREE.Mesh(crownGeo, caseMat);
        crown.position.set(0.25, 0, 0);
        crown.rotation.z = Math.PI / 2;
        crown.castShadow = true;
        caseGroup.add(crown);

        watchGroup.add(caseGroup);
        scene.add(watchGroup);

        // ─── Particles ──────────────────────────
        particles = createParticles(THREE);
        scene.add(particles);

        // ─── Ground Plane (shadow catcher) ──────
        const groundGeo = new THREE.PlaneGeometry(8, 8);
        const groundMat = new THREE.ShadowMaterial({ opacity: 0.15 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.55;
        ground.receiveShadow = true;
        scene.add(ground);

        setLoaded(true);

        // ─── Animation Loop ─────────────────────
        function animate() {
          animationId = requestAnimationFrame(animate);

          // Gentle rotation
          if (caseGroup) {
            caseGroup.rotation.y += 0.003;
          }

          // Float on scroll
          const scrollY = window.scrollY;
          const maxScroll = window.innerHeight;
          const scrollProgress = Math.min(scrollY / maxScroll, 1);

          if (watchGroup) {
            watchGroup.position.y = 0.4 - scrollProgress * 0.6;
            watchGroup.rotation.x = scrollProgress * 0.15;
          }

          // Particle movement
          if (particles) {
            particles.rotation.y += 0.0002;
            particles.children.forEach((p: any, i: number) => {
              p.position.y += 0.002;
              if (p.position.y > 3) p.position.y = -1;
              p.material.opacity = 0.3 + Math.sin(Date.now() * 0.001 + i) * 0.2;
            });
          }

          // Camera subtle movement (parallax)
          camera.position.x = Math.sin(scrollProgress * 0.5) * 1.5;
          camera.lookAt(0, 0.2 - scrollProgress * 0.3, 0);

          renderer.render(scene, camera);
        }
        animate();

        // ─── Resize Handler ─────────────────────
        function onResize() {
          if (!container) return;
          camera.aspect = container.clientWidth / container.clientHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(container.clientWidth, container.clientHeight);
        }
        window.addEventListener('resize', onResize);

      } catch (err) {
        console.warn('Hero3D: failed to initialize Three.js — falling back to gradient', err);
        setError(true);
      }
    }

    // Only run on desktop (skip 3D on mobile for performance)
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      setError(true);
      return;
    }

    initThree();

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (renderer?.domElement) {
        renderer.domElement.remove();
        renderer.dispose();
      }
    };
  }, []);

  // ─── Fallback: gradient background ──────────────────
  if (error || !loaded) {
    return (
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse at 50% 40%, rgba(212,175,55,0.08) 0%, transparent 60%),
            radial-gradient(ellipse at 50% 100%, rgba(212,175,55,0.04) 0%, transparent 50%),
            linear-gradient(to bottom, #0A0A0F 0%, #111118 100%)
          `,
        }}
      >
        {/* Loading pulse dot */}
        {!loaded && !error && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="w-3 h-3 rounded-full bg-wf-gold animate-pulse-glow" />
          </div>
        )}
      </div>
    );
  }

  return <div ref={containerRef} className="absolute inset-0" />;
}

// ─── Helpers ────────────────────────────────────────────

async function loadThreeJS(): Promise<any> {
  const win = window as ThreeJSWindow;
  if (win.THREE) return win.THREE;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    script.onload = () => {
      resolve((window as ThreeJSWindow).THREE);
    };
    script.onerror = () => reject(new Error('CDN load failed'));
    document.head.appendChild(script);
  });
}

function createEnvironmentMap(THREE: any) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Sky gradient: deep navy → warm horizon
  const sky = ctx.createLinearGradient(0, 0, 0, 280);
  sky.addColorStop(0, '#050d20');
  sky.addColorStop(0.5, '#0d1a30');
  sky.addColorStop(0.85, '#2a3850');
  sky.addColorStop(0.95, '#5a4830');
  sky.addColorStop(1, '#1a1510');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 280);

  // Horizon glow
  const glow = ctx.createLinearGradient(0, 260, 0, 300);
  glow.addColorStop(0.5, 'rgba(255,170,90,0.15)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 260, 1024, 40);

  // Ground
  ctx.fillStyle = '#080c16';
  ctx.fillRect(0, 300, 1024, 212);

  // City lights dots (subtle)
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * 1024;
    const y = 272 + Math.random() * 15;
    const size = 0.5 + Math.random() * 3;
    const alpha = Math.random() * 0.06;
    ctx.fillStyle = `rgba(255,190,120,${alpha})`;
    ctx.fillRect(x, y, size, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function createParticles(THREE: any) {
  const group = new THREE.Group();
  const goldMat = new THREE.MeshBasicMaterial({
    color: 0xd4af37,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });

  const count = 40;
  for (let i = 0; i < count; i++) {
    const size = 0.003 + Math.random() * 0.008;
    const geo = new THREE.SphereGeometry(size, 8, 8);
    const particle = new THREE.Mesh(geo, goldMat.clone());
    particle.position.set(
      (Math.random() - 0.5) * 4,
      Math.random() * 3 - 1,
      (Math.random() - 0.5) * 3
    );
    particle.userData = { speed: 0.001 + Math.random() * 0.004 };
    group.add(particle);
  }

  return group;
}
