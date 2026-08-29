/* eslint-disable react-refresh/only-export-components -- provider, hook, and locale options form one localization boundary */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type AppLanguage = 'en' | 'es' | 'pt' | 'zh' | 'ja';

export const APP_LANGUAGES: { code: AppLanguage; label: string; shortLabel: string }[] = [
  { code: 'en', label: 'English', shortLabel: 'EN' },
  { code: 'es', label: 'Español', shortLabel: 'ES' },
  { code: 'pt', label: 'Português', shortLabel: 'PT' },
  { code: 'zh', label: '简体中文', shortLabel: '中文' },
  { code: 'ja', label: '日本語', shortLabel: '日本語' },
];

const translations: Record<Exclude<AppLanguage, 'en'>, Record<string, string>> = {
  es: {
    'Live market activity': 'Actividad del mercado en vivo',
    'For verified dealers and wholesalers': 'Para distribuidores y mayoristas verificados',
    "The trading floor for the world's dealer network": 'El mercado para la red mundial de distribuidores',
    'Organized, source-backed market intelligence and dealer activity in one workspace, with Fi helping you spend less time scrolling and more time closing.': 'Inteligencia de mercado y actividad de distribuidores organizada y respaldada por fuentes en un solo espacio, con Fi ayudándote a buscar menos y cerrar más operaciones.',
    'Join the network': 'Únete a la red', 'See live Trading Floor': 'Ver el mercado en vivo',
    'Verified dealers': 'Distribuidores verificados', 'Daily listings': 'Anuncios diarios', 'Private channels': 'Canales privados', 'Average match time': 'Tiempo promedio de conexión',
    'Meet Fi': 'Conoce a Fi', 'Your AI agent, negotiating every match': 'Tu agente de IA, negociando cada oportunidad',
    'Fi reads WTS and WTB activity, cleans up the data, and opens the negotiation on your behalf. You step in once there is a real deal on the table.': 'Fi analiza la actividad WTS y WTB, organiza los datos e inicia la negociación en tu nombre. Tú intervienes cuando ya existe una oportunidad real.',
    'Finds the match': 'Encuentra la oportunidad', 'Opens the negotiation': 'Inicia la negociación', 'Closes with support': 'Cierra con respaldo', 'Hire Fi': 'Contrata a Fi',
    'From chat noise to a closed trade': 'Del ruido de los chats a una operación cerrada', 'Three steps, with most of the work done for you': 'Tres pasos, con la mayor parte del trabajo hecho para ti',
    'Post or browse': 'Publica o explora', 'Fi matches and negotiates': 'Fi conecta y negocia', 'Close with confidence': 'Cierra con confianza',
    'Built on trust, not just volume': 'Construido sobre confianza, no solo volumen', 'Every match runs through independent security and verification partners': 'Cada operación cuenta con socios independientes de seguridad y verificación',
    'Membership': 'Membresía', 'month': 'mes', 'Start your membership': 'Comienza tu membresía',
    'Full access to the Trading Floor and dealer network': 'Acceso completo al mercado y a la red de distribuidores', 'Fi negotiation support for WTS and WTB activity': 'Apoyo de negociación de Fi para actividad WTS y WTB',
    'Source-backed dealer ratings and Dealer Ref Check': 'Calificaciones respaldadas por fuentes y Dealer Ref Check', 'Priority access to inspection and escrow partners': 'Acceso prioritario a socios de inspección y depósito en garantía',
    'Stop scrolling. Start trading.': 'Deja de desplazarte. Empieza a negociar.', 'Join the verified dealer network already trading through Curated Luxury.': 'Únete a la red verificada de distribuidores que ya negocia mediante Curated Luxury.',
    'Language': 'Idioma',
    'TRADING FLOOR': 'MERCADO', 'PRICE RESEARCH': 'ANÁLISIS DE PRECIOS', 'REFERENCE CHECK': 'VERIFICACIÓN DE REFERENCIAS', 'WORKSPACE': 'ESPACIO DE TRABAJO', 'POST IT': 'PUBLICAR', 'ACCOUNT': 'CUENTA', 'HIRE FI': 'CONTRATAR A FI', 'HOME': 'INICIO',
    'A considered marketplace for collectors, dealers, and wholesalers': 'Un mercado cuidadosamente seleccionado para coleccionistas, distribuidores y mayoristas',
    'Discover more': 'Descubrir más', 'One connected market': 'Un mercado conectado', 'Built for every side of the trade.': 'Creado para todos los participantes del mercado.',
    'Curated Luxury brings exceptional objects, professional inventory, and market intelligence into one disciplined environment without flattening the different needs of buyers and sellers.': 'Curated Luxury reúne objetos excepcionales, inventario profesional e inteligencia de mercado en un entorno organizado que respeta las distintas necesidades de compradores y vendedores.',
    'Collectors': 'Coleccionistas', 'Dealers': 'Distribuidores', 'Wholesalers': 'Mayoristas',
    'Discover rare objects with the context, market evidence, and discretion needed to collect with conviction.': 'Descubre objetos excepcionales con el contexto, la evidencia de mercado y la discreción necesarios para coleccionar con confianza.',
    'Present exceptional inventory, understand current demand, and connect serious clients to the right opportunity.': 'Presenta inventario excepcional, comprende la demanda actual y conecta clientes serios con la oportunidad adecuada.',
    'Read supply across the market, compare dated pricing signals, and move inventory through a trusted professional network.': 'Analiza la oferta, compara señales de precios fechadas y mueve inventario mediante una red profesional confiable.',
    'The collection': 'La colección', 'Collect across worlds.': 'Colecciona entre distintos mundos.',
    'A single destination for pieces whose value lives in craft, scarcity, cultural meaning, and enduring desire.': 'Un destino único para piezas cuyo valor reside en la artesanía, la escasez, el significado cultural y el deseo perdurable.',
    'High jewelry': 'Alta joyería', 'Rare handbags': 'Bolsos excepcionales', 'Important watches': 'Relojes importantes', 'Singular objects': 'Objetos singulares',
    'Exceptional stones, signed pieces, and objects chosen for presence as much as rarity.': 'Piedras excepcionales, piezas firmadas y objetos elegidos tanto por su presencia como por su rareza.',
    'Coveted editions and enduring silhouettes for collectors who recognize the uncommon.': 'Ediciones codiciadas y siluetas duraderas para coleccionistas que reconocen lo extraordinario.',
    'Modern icons and historic references supported by a dedicated market-intelligence platform.': 'Iconos modernos y referencias históricas respaldados por una plataforma especializada de inteligencia de mercado.',
    'Art, design, and collectible pieces that resist easy classification and reward attention.': 'Arte, diseño y piezas de colección que desafían la clasificación y recompensan la atención.',
    'Private luxury marketplace': 'Mercado privado de lujo', 'Objects beyond the ordinary.': 'Objetos fuera de lo común.', 'It is a point of view.': 'Es un punto de vista.',
    'We bring exceptional objects into one considered marketplace. Some are icons. Others are known only to devoted collectors. Each deserves to be seen with context, care, and an appreciation for what makes it singular.': 'Reunimos objetos excepcionales en un mercado cuidadosamente seleccionado. Algunos son iconos; otros solo los conocen coleccionistas dedicados. Cada uno merece verse con contexto, cuidado y aprecio por aquello que lo hace singular.',
    'Explore the collection': 'Explorar la colección', 'Watch intelligence': 'Inteligencia de relojes',
    'A connected market perspective': 'Una perspectiva de mercado conectada', 'The right object changes the room around it.': 'El objeto adecuado transforma el espacio que lo rodea.',
    'Collecting is personal; the market behind it is connected. Curated Luxury gives collectors a clearer path to discovery while giving dealers and wholesalers a disciplined way to present, compare, and move exceptional inventory.': 'Coleccionar es personal, pero el mercado está conectado. Curated Luxury ofrece a los coleccionistas un camino más claro para descubrir y a distribuidores y mayoristas una forma organizada de presentar, comparar y mover inventario excepcional.',
    'View current opportunities': 'Ver oportunidades actuales', 'Discover': 'Descubrir', 'Understand': 'Comprender', 'Acquire': 'Adquirir',
    'Explore objects selected across categories, periods, and collecting cultures.': 'Explora objetos seleccionados entre categorías, épocas y culturas de colección.',
    'Consider the context, condition, market history, and documentation surrounding each piece.': 'Considera el contexto, el estado, el historial de mercado y la documentación de cada pieza.',
    'Connect with the market through a discreet, considered path from interest to ownership.': 'Conecta con el mercado mediante un proceso discreto y considerado desde el interés hasta la propiedad.',
    'Enter Curated Luxury': 'Entrar a Curated Luxury', 'Choose your point of entry.': 'Elige tu punto de entrada.',
    'Collectors can browse the live marketplace and watch intelligence. Dealers and wholesalers can enter the secure professional workspace.': 'Los coleccionistas pueden explorar el mercado en vivo y la inteligencia de relojes. Los distribuidores y mayoristas pueden entrar al espacio profesional seguro.',
    'Current luxury listings across the marketplace': 'Anuncios actuales de lujo en el mercado', 'Reference-level pricing and market evidence': 'Precios y evidencia de mercado por referencia', 'Private access': 'Acceso privado', 'Secure workspace for dealers and partners': 'Espacio seguro para distribuidores y socios',
    'Workspace': 'Espacio de trabajo', 'Authenticated posting': 'Publicación autenticada', 'Curated Luxury form': 'Formulario Curated Luxury',
    'Direct normalized posting': 'Publicación normalizada directa', 'Photograph it. Describe it. Post it.': 'Fotografíalo. Descríbelo. Publícalo.',
    'Required identity and source fields keep each item organized. Price remains optional; when omitted, the Trading Floor displays “Price not supplied.”': 'Los campos obligatorios de identidad y fuente mantienen cada artículo organizado. El precio es opcional; si se omite, el mercado muestra “Precio no proporcionado”.',
    'One item': 'Un artículo', 'Several separate items': 'Varios artículos separados', 'One bundle or dealer list': 'Un lote o lista de distribuidor',
    'Post one watch or luxury item with its own message and photos.': 'Publica un reloj o artículo de lujo con su propio mensaje y fotos.',
    'Create one card per item. Seller credentials are stamped automatically, while every watch keeps its own reference, price, message, and photos.': 'Crea una ficha por artículo. Las credenciales del vendedor se añaden automáticamente y cada reloj conserva su referencia, precio, mensaje y fotos.',
    'Paste the complete dealer list once and add the original group photos. We keep it intact in the deferred bundle lane; no group photo is assigned to an individual watch.': 'Pega una vez la lista completa y añade las fotos originales del grupo. Se conserva intacta en la cola de lotes; ninguna foto grupal se asigna a un reloj individual.',
    'Credentialed posting user': 'Usuario verificado que publica', 'Rating': 'Calificación', 'reviews': 'reseñas', 'groups': 'grupos',
    'Stamped from the signed-in credential · identity fields cannot be edited here.': 'Datos añadidos desde la credencial iniciada · la identidad no puede editarse aquí.',
    'Update credentialed profile photo': 'Actualizar foto de perfil verificado', 'Add credentialed profile photo': 'Añadir foto de perfil verificado',
    'Optional. This becomes the posting-user photo attached to the credential.': 'Opcional. Será la foto del usuario que publica asociada a la credencial.',
    'Add a blank item': 'Añadir un artículo vacío', 'ready': 'listos', 'item photos': 'fotos de artículos', 'Deferred bundle lane': 'Cola de lotes diferida', 'Trading Floor publication': 'Publicación en el mercado',
    'Your recent posts': 'Tus publicaciones recientes', 'Published items remain available for later human quality review.': 'Los artículos publicados permanecen disponibles para una revisión humana posterior.', 'No posts yet.': 'Aún no hay publicaciones.', 'Post received': 'Publicación recibida',
    'Post an item.': 'Publicar un artículo.', 'Use the connected Luxury App without leaving Curated Luxury.': 'Usa la aplicación Luxury conectada sin salir de Curated Luxury.', 'Open full page': 'Abrir página completa',
    'Complete bundle or dealer list': 'Lote completo o lista de distribuidor', 'Item': 'Artículo', 'Kept together': 'Conservado unido', 'Add similar': 'Añadir similar', 'Remove item': 'Eliminar artículo',
    'Listing type': 'Tipo de anuncio', 'For sale': 'En venta', 'Want to buy': 'Quiero comprar', 'Category': 'Categoría', 'Watch': 'Reloj', 'Handbag': 'Bolso', 'Jewelry': 'Joyería', 'Other accessory': 'Otro accesorio', 'Other luxury item': 'Otro artículo de lujo',
    'Bundle title (optional)': 'Título del lote (opcional)', 'Brand': 'Marca', 'Model': 'Modelo', 'Reference': 'Referencia', 'Dial color': 'Color de esfera', 'Item title': 'Título del artículo', 'Condition': 'Estado', 'Asking price (optional)': 'Precio solicitado (opcional)', 'Currency': 'Moneda',
    'Paste the complete original bundle or dealer list': 'Pega el lote o lista original completa', 'Original listing or request message': 'Mensaje original del anuncio o solicitud',
    'Paste the full message exactly as written. Keep every watch, price, currency, and line break.': 'Pega el mensaje completo exactamente como fue escrito. Conserva cada reloj, precio, moneda y salto de línea.',
    'Take or choose the original group photos': 'Toma o elige las fotos originales del grupo', 'Take or choose item photos': 'Toma o elige fotos del artículo', 'photos · preserved with this bundle only': 'fotos · conservadas solo con este lote', 'photos · first photo is the Trading Floor cover': 'fotos · la primera es la portada del mercado', 'Cover': 'Portada', 'Remove photo': 'Eliminar foto',
    'Contact': 'Contacto', 'Contact Curated Luxury': 'Contactar a Curated Luxury', 'Email Curated Luxury at': 'Escribe a Curated Luxury en', 'Questions, partnerships, listing support, or new opportunities.': 'Preguntas, alianzas, ayuda con anuncios o nuevas oportunidades.', 'Contact us on WhatsApp': 'Contáctanos por WhatsApp', 'Name': 'Nombre', 'Email': 'Correo electrónico', 'How can we help?': '¿Cómo podemos ayudarte?', 'Email destination pending': 'Destino de correo pendiente', 'The form will be activated after the receiving email or support system is confirmed.': 'El formulario se activará cuando se confirme el correo o sistema de soporte receptor.', 'Community': 'Comunidad', 'Join Our Chats': 'Únete a nuestros chats', 'Be part of our vibrant community by joining our WhatsApp and Telegram groups.': 'Forma parte de nuestra comunidad uniéndote a nuestros grupos de WhatsApp y Telegram.', 'Curated Luxury marketplace intelligence for exceptional objects.': 'Inteligencia de mercado Curated Luxury para objetos excepcionales.', 'Company': 'Empresa', 'All Rights Reserved.': 'Todos los derechos reservados.'
  },
  pt: {
    'Live market activity': 'Atividade do mercado ao vivo',
    'For verified dealers and wholesalers': 'Para revendedores e atacadistas verificados',
    "The trading floor for the world's dealer network": 'O mercado da rede mundial de revendedores',
    'Organized, source-backed market intelligence and dealer activity in one workspace, with Fi helping you spend less time scrolling and more time closing.': 'Inteligência de mercado e atividade de revendedores organizadas e respaldadas por fontes em um único espaço, com Fi ajudando você a pesquisar menos e fechar mais negócios.',
    'Join the network': 'Entre na rede', 'See live Trading Floor': 'Ver o mercado ao vivo',
    'Verified dealers': 'Revendedores verificados', 'Daily listings': 'Anúncios diários', 'Private channels': 'Canais privados', 'Average match time': 'Tempo médio de conexão',
    'Meet Fi': 'Conheça a Fi', 'Your AI agent, negotiating every match': 'Sua agente de IA, negociando cada oportunidade',
    'Fi reads WTS and WTB activity, cleans up the data, and opens the negotiation on your behalf. You step in once there is a real deal on the table.': 'Fi analisa a atividade WTS e WTB, organiza os dados e inicia a negociação em seu nome. Você entra quando já existe uma oportunidade real.',
    'Finds the match': 'Encontra a oportunidade', 'Opens the negotiation': 'Inicia a negociação', 'Closes with support': 'Fecha com suporte', 'Hire Fi': 'Contrate a Fi',
    'From chat noise to a closed trade': 'Do ruído dos chats a um negócio fechado', 'Three steps, with most of the work done for you': 'Três etapas, com a maior parte do trabalho feita para você',
    'Post or browse': 'Publique ou explore', 'Fi matches and negotiates': 'Fi conecta e negocia', 'Close with confidence': 'Feche com confiança',
    'Built on trust, not just volume': 'Construído com confiança, não apenas volume', 'Every match runs through independent security and verification partners': 'Cada negócio passa por parceiros independentes de segurança e verificação',
    'Membership': 'Assinatura', 'month': 'mês', 'Start your membership': 'Inicie sua assinatura',
    'Full access to the Trading Floor and dealer network': 'Acesso completo ao mercado e à rede de revendedores', 'Fi negotiation support for WTS and WTB activity': 'Suporte de negociação da Fi para atividade WTS e WTB',
    'Source-backed dealer ratings and Dealer Ref Check': 'Avaliações respaldadas por fontes e Dealer Ref Check', 'Priority access to inspection and escrow partners': 'Acesso prioritário a parceiros de inspeção e custódia',
    'Stop scrolling. Start trading.': 'Pare de rolar. Comece a negociar.', 'Join the verified dealer network already trading through Curated Luxury.': 'Entre na rede verificada de revendedores que já negocia pela Curated Luxury.',
    'Language': 'Idioma',
    'TRADING FLOOR': 'MERCADO', 'PRICE RESEARCH': 'PESQUISA DE PREÇOS', 'REFERENCE CHECK': 'VERIFICAÇÃO DE REFERÊNCIAS', 'WORKSPACE': 'ÁREA DE TRABALHO', 'POST IT': 'PUBLICAR', 'ACCOUNT': 'CONTA', 'HIRE FI': 'CONTRATAR FI', 'HOME': 'INÍCIO',
    'A considered marketplace for collectors, dealers, and wholesalers': 'Um mercado cuidadosamente selecionado para colecionadores, revendedores e atacadistas', 'Discover more': 'Descobrir mais',
    'One connected market': 'Um mercado conectado', 'Built for every side of the trade.': 'Criado para todos os lados do mercado.',
    'Curated Luxury brings exceptional objects, professional inventory, and market intelligence into one disciplined environment without flattening the different needs of buyers and sellers.': 'A Curated Luxury reúne objetos excepcionais, estoque profissional e inteligência de mercado em um ambiente organizado que respeita as diferentes necessidades de compradores e vendedores.',
    'Collectors': 'Colecionadores', 'Dealers': 'Revendedores', 'Wholesalers': 'Atacadistas',
    'Discover rare objects with the context, market evidence, and discretion needed to collect with conviction.': 'Descubra objetos raros com o contexto, as evidências de mercado e a discrição necessários para colecionar com confiança.',
    'Present exceptional inventory, understand current demand, and connect serious clients to the right opportunity.': 'Apresente estoque excepcional, compreenda a demanda atual e conecte clientes sérios à oportunidade certa.',
    'Read supply across the market, compare dated pricing signals, and move inventory through a trusted professional network.': 'Analise a oferta do mercado, compare sinais de preço datados e movimente estoque por uma rede profissional confiável.',
    'The collection': 'A coleção', 'Collect across worlds.': 'Colecione entre diferentes mundos.',
    'A single destination for pieces whose value lives in craft, scarcity, cultural meaning, and enduring desire.': 'Um único destino para peças cujo valor está no artesanato, na escassez, no significado cultural e no desejo duradouro.',
    'High jewelry': 'Alta joalheria', 'Rare handbags': 'Bolsas raras', 'Important watches': 'Relógios importantes', 'Singular objects': 'Objetos singulares',
    'Exceptional stones, signed pieces, and objects chosen for presence as much as rarity.': 'Pedras excepcionais, peças assinadas e objetos escolhidos tanto pela presença quanto pela raridade.',
    'Coveted editions and enduring silhouettes for collectors who recognize the uncommon.': 'Edições cobiçadas e silhuetas duradouras para colecionadores que reconhecem o incomum.',
    'Modern icons and historic references supported by a dedicated market-intelligence platform.': 'Ícones modernos e referências históricas apoiados por uma plataforma dedicada de inteligência de mercado.',
    'Art, design, and collectible pieces that resist easy classification and reward attention.': 'Arte, design e peças colecionáveis que desafiam classificações simples e recompensam a atenção.',
    'Private luxury marketplace': 'Mercado privado de luxo', 'Objects beyond the ordinary.': 'Objetos além do comum.', 'It is a point of view.': 'É um ponto de vista.',
    'We bring exceptional objects into one considered marketplace. Some are icons. Others are known only to devoted collectors. Each deserves to be seen with context, care, and an appreciation for what makes it singular.': 'Reunimos objetos excepcionais em um mercado cuidadosamente selecionado. Alguns são ícones; outros são conhecidos apenas por colecionadores dedicados. Cada um merece ser visto com contexto, cuidado e apreço pelo que o torna singular.',
    'Explore the collection': 'Explorar a coleção', 'Watch intelligence': 'Inteligência de relógios',
    'A connected market perspective': 'Uma perspectiva de mercado conectada', 'The right object changes the room around it.': 'O objeto certo transforma o ambiente ao seu redor.', 'View current opportunities': 'Ver oportunidades atuais',
    'Collecting is personal; the market behind it is connected. Curated Luxury gives collectors a clearer path to discovery while giving dealers and wholesalers a disciplined way to present, compare, and move exceptional inventory.': 'Colecionar é pessoal, mas o mercado é conectado. A Curated Luxury oferece aos colecionadores um caminho mais claro para descobrir e aos revendedores e atacadistas uma forma organizada de apresentar, comparar e movimentar estoque excepcional.',
    'Discover': 'Descobrir', 'Understand': 'Compreender', 'Acquire': 'Adquirir',
    'Explore objects selected across categories, periods, and collecting cultures.': 'Explore objetos selecionados entre categorias, épocas e culturas de coleção.',
    'Consider the context, condition, market history, and documentation surrounding each piece.': 'Considere o contexto, a condição, o histórico de mercado e a documentação de cada peça.',
    'Connect with the market through a discreet, considered path from interest to ownership.': 'Conecte-se ao mercado por um caminho discreto e cuidadoso, do interesse à propriedade.',
    'Enter Curated Luxury': 'Entrar na Curated Luxury', 'Choose your point of entry.': 'Escolha seu ponto de entrada.', 'Private access': 'Acesso privado',
    'Collectors can browse the live marketplace and watch intelligence. Dealers and wholesalers can enter the secure professional workspace.': 'Colecionadores podem explorar o mercado ao vivo e a inteligência de relógios. Revendedores e atacadistas podem entrar na área profissional segura.',
    'Current luxury listings across the marketplace': 'Anúncios atuais de luxo no mercado', 'Reference-level pricing and market evidence': 'Preços e evidências de mercado por referência', 'Secure workspace for dealers and partners': 'Área segura para revendedores e parceiros',
    'Workspace': 'Área de trabalho', 'Authenticated posting': 'Publicação autenticada', 'Curated Luxury form': 'Formulário Curated Luxury', 'Direct normalized posting': 'Publicação normalizada direta', 'Photograph it. Describe it. Post it.': 'Fotografe. Descreva. Publique.',
    'Required identity and source fields keep each item organized. Price remains optional; when omitted, the Trading Floor displays “Price not supplied.”': 'Os campos obrigatórios de identidade e fonte mantêm cada item organizado. O preço é opcional; se omitido, o mercado exibe “Preço não informado”.',
    'One item': 'Um item', 'Several separate items': 'Vários itens separados', 'One bundle or dealer list': 'Um lote ou lista de revendedor',
    'Post one watch or luxury item with its own message and photos.': 'Publique um relógio ou item de luxo com sua própria mensagem e fotos.',
    'Create one card per item. Seller credentials are stamped automatically, while every watch keeps its own reference, price, message, and photos.': 'Crie uma ficha por item. As credenciais do vendedor são adicionadas automaticamente, enquanto cada relógio mantém sua referência, preço, mensagem e fotos.',
    'Paste the complete dealer list once and add the original group photos. We keep it intact in the deferred bundle lane; no group photo is assigned to an individual watch.': 'Cole a lista completa uma vez e adicione as fotos originais do grupo. Ela permanece intacta na fila de lotes; nenhuma foto de grupo é atribuída a um relógio individual.',
    'Credentialed posting user': 'Usuário verificado que publica', 'Rating': 'Avaliação', 'reviews': 'avaliações', 'groups': 'grupos',
    'Stamped from the signed-in credential · identity fields cannot be edited here.': 'Dados aplicados a partir da credencial ativa · os campos de identidade não podem ser editados aqui.',
    'Update credentialed profile photo': 'Atualizar foto do perfil verificado', 'Add credentialed profile photo': 'Adicionar foto do perfil verificado', 'Optional. This becomes the posting-user photo attached to the credential.': 'Opcional. Esta será a foto do usuário vinculada à credencial.',
    'Add a blank item': 'Adicionar item vazio', 'ready': 'prontos', 'item photos': 'fotos dos itens', 'Deferred bundle lane': 'Fila de lotes adiada', 'Trading Floor publication': 'Publicação no mercado',
    'Your recent posts': 'Suas publicações recentes', 'Published items remain available for later human quality review.': 'Os itens publicados ficam disponíveis para revisão humana posterior.', 'No posts yet.': 'Ainda não há publicações.', 'Post received': 'Publicação recebida',
    'Post an item.': 'Publicar um item.', 'Use the connected Luxury App without leaving Curated Luxury.': 'Use o Luxury App conectado sem sair da Curated Luxury.', 'Open full page': 'Abrir página completa',
    'Complete bundle or dealer list': 'Lote completo ou lista de revendedor', 'Item': 'Item', 'Kept together': 'Mantido junto', 'Add similar': 'Adicionar semelhante', 'Remove item': 'Remover item', 'Listing type': 'Tipo de anúncio', 'For sale': 'À venda', 'Want to buy': 'Quero comprar',
    'Category': 'Categoria', 'Watch': 'Relógio', 'Handbag': 'Bolsa', 'Jewelry': 'Joia', 'Other accessory': 'Outro acessório', 'Other luxury item': 'Outro item de luxo', 'Bundle title (optional)': 'Título do lote (opcional)', 'Brand': 'Marca', 'Model': 'Modelo', 'Reference': 'Referência', 'Dial color': 'Cor do mostrador', 'Item title': 'Título do item', 'Condition': 'Condição', 'Asking price (optional)': 'Preço pedido (opcional)', 'Currency': 'Moeda',
    'Paste the complete original bundle or dealer list': 'Cole o lote ou lista original completa', 'Original listing or request message': 'Mensagem original do anúncio ou pedido', 'Take or choose the original group photos': 'Tire ou escolha as fotos originais do grupo', 'Take or choose item photos': 'Tire ou escolha fotos do item', 'Cover': 'Capa', 'Remove photo': 'Remover foto',
    'Contact': 'Contato', 'Contact Curated Luxury': 'Fale com a Curated Luxury', 'Email Curated Luxury at': 'Envie um e-mail para Curated Luxury em', 'Contact us on WhatsApp': 'Fale conosco pelo WhatsApp', 'Name': 'Nome', 'Email': 'E-mail', 'How can we help?': 'Como podemos ajudar?', 'Email destination pending': 'Destino de e-mail pendente', 'Community': 'Comunidade', 'Join Our Chats': 'Participe dos nossos chats', 'Be part of our vibrant community by joining our WhatsApp and Telegram groups.': 'Faça parte da nossa comunidade nos grupos de WhatsApp e Telegram.', 'Curated Luxury marketplace intelligence for exceptional objects.': 'Inteligência de mercado Curated Luxury para objetos excepcionais.', 'Company': 'Empresa', 'All Rights Reserved.': 'Todos os direitos reservados.'
  },
  zh: {
    'Live market activity': '实时市场动态',
    'For verified dealers and wholesalers': '面向认证经销商和批发商',
    "The trading floor for the world's dealer network": '服务全球经销商网络的交易市场',
    'Organized, source-backed market intelligence and dealer activity in one workspace, with Fi helping you spend less time scrolling and more time closing.': '在一个工作空间中集中呈现有来源依据的市场情报与经销商活动，并由 Fi 帮助您减少搜索时间、加快成交。',
    'Join the network': '加入网络', 'See live Trading Floor': '查看实时交易市场',
    'Verified dealers': '认证经销商', 'Daily listings': '每日发布', 'Private channels': '私人频道', 'Average match time': '平均匹配时间',
    'Meet Fi': '认识 Fi', 'Your AI agent, negotiating every match': '为每次机会进行谈判的 AI 助手',
    'Fi reads WTS and WTB activity, cleans up the data, and opens the negotiation on your behalf. You step in once there is a real deal on the table.': 'Fi 分析 WTS 和 WTB 活动、整理数据并代表您开启谈判。只有在出现真实交易机会时才需要您参与。',
    'Finds the match': '寻找匹配', 'Opens the negotiation': '开启谈判', 'Closes with support': '协助成交', 'Hire Fi': '聘用 Fi',
    'From chat noise to a closed trade': '从群聊噪音到完成交易', 'Three steps, with most of the work done for you': '三个步骤，大部分工作由系统完成',
    'Post or browse': '发布或浏览', 'Fi matches and negotiates': 'Fi 匹配并谈判', 'Close with confidence': '安心成交',
    'Built on trust, not just volume': '以信任为基础，而不只是数量', 'Every match runs through independent security and verification partners': '每次匹配均由独立安全与验证合作伙伴支持',
    'Membership': '会员', 'month': '月', 'Start your membership': '开始会员服务',
    'Full access to the Trading Floor and dealer network': '完整访问交易市场和经销商网络', 'Fi negotiation support for WTS and WTB activity': 'Fi 为 WTS 和 WTB 活动提供谈判支持',
    'Source-backed dealer ratings and Dealer Ref Check': '有来源依据的经销商评级与 Dealer Ref Check', 'Priority access to inspection and escrow partners': '优先使用检验和托管合作伙伴服务',
    'Stop scrolling. Start trading.': '停止刷屏，开始交易。', 'Join the verified dealer network already trading through Curated Luxury.': '加入已经通过 Curated Luxury 开展交易的认证经销商网络。',
    'Language': '语言',
    'TRADING FLOOR': '交易大厅', 'PRICE RESEARCH': '价格研究', 'REFERENCE CHECK': '背景核查', 'WORKSPACE': '工作区', 'POST IT': '发布商品', 'ACCOUNT': '账户', 'HIRE FI': '聘用 FI', 'HOME': '首页',
    'A considered marketplace for collectors, dealers, and wholesalers': '面向收藏家、经销商和批发商的精选市场', 'Discover more': '探索更多', 'One connected market': '互联市场', 'Built for every side of the trade.': '服务交易市场的每一方。',
    'Curated Luxury brings exceptional objects, professional inventory, and market intelligence into one disciplined environment without flattening the different needs of buyers and sellers.': 'Curated Luxury 将非凡藏品、专业库存和市场情报汇集于一个有序环境，同时尊重买卖双方的不同需求。',
    'Collectors': '收藏家', 'Dealers': '经销商', 'Wholesalers': '批发商',
    'Discover rare objects with the context, market evidence, and discretion needed to collect with conviction.': '通过背景信息、市场证据和必要的私密性，发现稀有藏品并自信收藏。',
    'Present exceptional inventory, understand current demand, and connect serious clients to the right opportunity.': '展示优质库存，了解当前需求，并将诚意客户与合适机会连接起来。',
    'Read supply across the market, compare dated pricing signals, and move inventory through a trusted professional network.': '洞察市场供应，比较带日期的价格信号，并通过可信赖的专业网络流转库存。',
    'The collection': '精选藏品', 'Collect across worlds.': '跨越不同领域收藏。', 'A single destination for pieces whose value lives in craft, scarcity, cultural meaning, and enduring desire.': '一个汇集精湛工艺、稀缺性、文化意义与持久吸引力藏品的平台。',
    'High jewelry': '高级珠宝', 'Rare handbags': '珍稀手袋', 'Important watches': '重要腕表', 'Singular objects': '独特藏品',
    'Exceptional stones, signed pieces, and objects chosen for presence as much as rarity.': '精选珍贵宝石、品牌签名作品，以及兼具气场与稀有性的藏品。', 'Coveted editions and enduring silhouettes for collectors who recognize the uncommon.': '为懂得非凡价值的收藏家呈现备受追捧的版本与经典轮廓。', 'Modern icons and historic references supported by a dedicated market-intelligence platform.': '由专业市场情报平台支持的现代经典与历史型号。', 'Art, design, and collectible pieces that resist easy classification and reward attention.': '难以简单归类、值得细细品味的艺术、设计与收藏作品。',
    'Private luxury marketplace': '私人奢侈品市场', 'Objects beyond the ordinary.': '非凡之物。', 'It is a point of view.': '这是一种眼光。', 'We bring exceptional objects into one considered marketplace. Some are icons. Others are known only to devoted collectors. Each deserves to be seen with context, care, and an appreciation for what makes it singular.': '我们将非凡藏品汇集于精心打造的市场。有些是经典之作，有些仅为资深收藏家所知。每件藏品都值得在充分背景与细致关怀中被欣赏。', 'Explore the collection': '探索藏品', 'Watch intelligence': '腕表市场情报',
    'A connected market perspective': '互联的市场视角', 'The right object changes the room around it.': '合适的藏品能够改变周围空间。', 'Collecting is personal; the market behind it is connected. Curated Luxury gives collectors a clearer path to discovery while giving dealers and wholesalers a disciplined way to present, compare, and move exceptional inventory.': '收藏是个人选择，但背后的市场彼此相连。Curated Luxury 为收藏家提供更清晰的发现路径，也为经销商和批发商提供有序展示、比较和流转优质库存的方式。', 'View current opportunities': '查看当前机会', 'Discover': '发现', 'Understand': '了解', 'Acquire': '购藏', 'Explore objects selected across categories, periods, and collecting cultures.': '探索跨越类别、年代与收藏文化的精选藏品。', 'Consider the context, condition, market history, and documentation surrounding each piece.': '了解每件藏品的背景、品相、市场历史与相关文件。', 'Connect with the market through a discreet, considered path from interest to ownership.': '通过私密而审慎的路径，从兴趣走向拥有。', 'Enter Curated Luxury': '进入 Curated Luxury', 'Choose your point of entry.': '选择您的入口。', 'Private access': '私人访问', 'Collectors can browse the live marketplace and watch intelligence. Dealers and wholesalers can enter the secure professional workspace.': '收藏家可浏览实时市场与腕表情报；经销商和批发商可进入安全的专业工作区。', 'Current luxury listings across the marketplace': '市场中的当前奢侈品信息', 'Reference-level pricing and market evidence': '按参考编号提供价格与市场证据', 'Secure workspace for dealers and partners': '面向经销商与合作伙伴的安全工作区',
    'Workspace': '工作区', 'Authenticated posting': '认证发布', 'Curated Luxury form': 'Curated Luxury 表单', 'Direct normalized posting': '直接规范化发布', 'Photograph it. Describe it. Post it.': '拍摄、描述、发布。',
    'Required identity and source fields keep each item organized. Price remains optional; when omitted, the Trading Floor displays “Price not supplied.”': '必填的身份和来源字段可确保商品信息有序。价格可选；未填写时，交易大厅将显示“未提供价格”。',
    'One item': '单件商品', 'Several separate items': '多件独立商品', 'One bundle or dealer list': '一个组合或经销商清单', 'Post one watch or luxury item with its own message and photos.': '发布一件腕表或奢侈品，并附上独立消息和照片。', 'Create one card per item. Seller credentials are stamped automatically, while every watch keeps its own reference, price, message, and photos.': '为每件商品创建独立卡片。系统自动附加卖家认证信息，每枚腕表保留自己的参考编号、价格、消息和照片。', 'Paste the complete dealer list once and add the original group photos. We keep it intact in the deferred bundle lane; no group photo is assigned to an individual watch.': '一次粘贴完整经销商清单并添加原始组合照片。系统会在待处理组合通道中完整保留，群组照片不会分配给单枚腕表。',
    'Credentialed posting user': '已认证发布用户', 'Rating': '评分', 'reviews': '条评价', 'groups': '个群组', 'Stamped from the signed-in credential · identity fields cannot be edited here.': '信息来自当前登录凭证 · 身份字段无法在此编辑。', 'Update credentialed profile photo': '更新认证头像', 'Add credentialed profile photo': '添加认证头像', 'Optional. This becomes the posting-user photo attached to the credential.': '可选。此照片将作为与凭证关联的发布用户头像。', 'Add a blank item': '添加空白商品', 'ready': '已就绪', 'item photos': '商品照片', 'Deferred bundle lane': '待处理组合通道', 'Trading Floor publication': '发布到交易大厅',
    'Your recent posts': '最近发布', 'Published items remain available for later human quality review.': '已发布商品仍可供后续人工质量审核。', 'No posts yet.': '暂无发布。', 'Post received': '已收到发布', 'Post an item.': '发布商品。', 'Use the connected Luxury App without leaving Curated Luxury.': '无需离开 Curated Luxury 即可使用已连接的 Luxury App。', 'Open full page': '打开完整页面',
    'Complete bundle or dealer list': '完整组合或经销商清单', 'Item': '商品', 'Kept together': '保持整体', 'Add similar': '添加类似商品', 'Remove item': '移除商品', 'Listing type': '发布类型', 'For sale': '出售', 'Want to buy': '求购', 'Category': '类别', 'Watch': '腕表', 'Handbag': '手袋', 'Jewelry': '珠宝', 'Other accessory': '其他配饰', 'Other luxury item': '其他奢侈品',
    'Bundle title (optional)': '组合标题（可选）', 'Brand': '品牌', 'Model': '型号', 'Reference': '参考编号', 'Dial color': '表盘颜色', 'Item title': '商品标题', 'Condition': '成色', 'Asking price (optional)': '报价（可选）', 'Currency': '币种', 'Paste the complete original bundle or dealer list': '粘贴完整的原始组合或经销商清单', 'Original listing or request message': '原始出售或求购消息', 'Take or choose the original group photos': '拍摄或选择原始组合照片', 'Take or choose item photos': '拍摄或选择商品照片', 'Cover': '封面', 'Remove photo': '移除照片',
    'Contact': '联系', 'Contact Curated Luxury': '联系 Curated Luxury', 'Email Curated Luxury at': '发送邮件至 Curated Luxury', 'Contact us on WhatsApp': '通过 WhatsApp 联系我们', 'Name': '姓名', 'Email': '电子邮件', 'How can we help?': '我们能为您做什么？', 'Email destination pending': '收件邮箱待确认', 'Community': '社区', 'Join Our Chats': '加入聊天群', 'Be part of our vibrant community by joining our WhatsApp and Telegram groups.': '加入我们的 WhatsApp 和 Telegram 群组，成为社区的一员。', 'Curated Luxury marketplace intelligence for exceptional objects.': 'Curated Luxury 为珍贵物品提供市场情报。', 'Company': '公司', 'All Rights Reserved.': '版权所有。'
  },
  ja: {
    'Language': '言語',
    'TRADING FLOOR': '取引フロア', 'PRICE RESEARCH': '価格調査', 'REFERENCE CHECK': 'リファレンス確認',
    'WORKSPACE': 'ワークスペース', 'POST IT': '出品', 'ACCOUNT': 'アカウント', 'HIRE FI': 'FIを利用', 'HOME': 'ホーム',
    'Trading Floor': '取引フロア', 'Filters': 'フィルター', 'Filter inventory': '在庫を絞り込む',
    'Category': 'カテゴリー', 'All inventory': 'すべての在庫', 'Watches': '腕時計', 'Handbags': 'ハンドバッグ',
    'Jewelry': 'ジュエリー', 'Accessories': 'アクセサリー', 'Other luxury': 'その他のラグジュアリー',
    'All activity': 'すべて', 'For sale': '販売', 'Want to buy': '購入希望', 'Listing type': '取引区分',
    'Order': '並び順', 'Newest observed': '新着順', 'Discovery mix': 'おすすめ順',
    'Brand': 'ブランド', 'All brands': 'すべてのブランド', 'Model': 'モデル', 'All models': 'すべてのモデル',
    'Location': '国・地域', 'All locations': 'すべての国・地域', 'No location data available': '国・地域データはありません',
    'No matching locations': '一致する国・地域はありません', 'Evidence': '根拠',
    'Verified source image only': '出典確認済み画像のみ', 'Price supplied': '価格あり',
    'Price not supplied': '価格未記載', 'Original raw message': '元の投稿メッセージ',
    'Posted by': '投稿者', 'Posted': '投稿日', 'Location not provided': '国・地域未記載',
    'Check availability': '在庫を確認', 'Open for rating': '評価データ準備中', 'No listings found': '該当する出品はありません',
    'View results': '結果を見る', 'Clear': 'クリア', 'Close filters': 'フィルターを閉じる',
    'Search exact reference, model, message, or poster': 'リファレンス、モデル、投稿文、投稿者を検索',
    'Search locations...': '国・地域を検索...', 'NO IMAGE': '画像なし', 'Posting date requires review': '投稿日確認中',
    'Currency converter': '通貨換算', 'Live market activity': 'リアルタイム市場情報',
    'DEALER ACCOUNT': 'ディーラーアカウント', 'Listing total unavailable': '出品総数を取得できません', 'verified listings': '件の確認済み出品',
    'Grid': 'グリッド', 'List': 'リスト', 'Showing': '表示中', 'on this page': '件（このページ）', 'total unavailable': '総数未取得',
    'of': '/', 'listings': '件', 'Priced listings first; source images next; highest verified USD price within each group.': '価格確認済みを優先し、次に出典画像、各グループ内では確認済み米ドル価格の高い順に表示します。',
    'Previous': '前へ', 'Page': 'ページ', 'Loading...': '読み込み中...', 'Next': '次へ',
    'Newest observed is the default. Discovery mix changes order only.': '初期表示は新着順です。おすすめ順は表示順だけを変更します。',
    'Contact': 'お問い合わせ', 'Company': '会社情報', 'Community': 'コミュニティ', 'All Rights Reserved.': '無断転載を禁じます。'
  },
};

type LanguageContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  t: (source: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);
const STORAGE_KEY = 'watchfacts-language';

function detectLanguage(): AppLanguage {
  const saved = window.localStorage.getItem(STORAGE_KEY) as AppLanguage | null;
  if (APP_LANGUAGES.some(option => option.code === saved)) return saved!;
  const browserLanguage = window.navigator.language.toLowerCase();
  if (browserLanguage.startsWith('es')) return 'es';
  if (browserLanguage.startsWith('pt')) return 'pt';
  if (browserLanguage.startsWith('zh')) return 'zh';
  if (browserLanguage.startsWith('ja')) return 'ja';
  return 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>(detectLanguage);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : language;
  }, [language]);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    t: (source: string) => language === 'en' ? source : translations[language][source] || source,
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}
