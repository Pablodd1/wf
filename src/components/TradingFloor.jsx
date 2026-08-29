import React, { useState, useEffect } from 'react';
import './TradingFloor.css';

const TradingFloor = () => {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    sourceImageOnly: true,
    location: '',
    brand: '',
    reference: '',
    dial: '',
    condition: '',
    priceMin: '',
    priceMax: '',
    sort: 'newest'
  });
  const [selectedListing, setSelectedListing] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // Fetch listings
  useEffect(() => {
    fetchListings();
  }, [filters, page]);

  const fetchListings = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: '100',
        ...(filters.brand && { brand: filters.brand }),
        ...(filters.reference && { reference: filters.reference }),
        ...(filters.dial && { dial: filters.dial }),
        ...(filters.condition && { condition: filters.condition }),
        ...(filters.sourceImageOnly && { images: 'true' }),
      });

      const res = await fetch(`/api/reviewed-market-inventory?${params}`);
      const data = await res.json();
      
      if (data.status === 'ok') {
        setListings(prev => page === 1 ? data.records : [...prev, ...data.records]);
        setHasMore(data.hasMore);
      }
    } catch (error) {
      console.error('Failed to fetch listings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
    setListings([]);
  };

  const formatPrice = (price) => {
    if (!price) return 'Price on request';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  const maskPhone = (phone) => {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 4) return phone;
    return `+${cleaned.slice(0, -4)}****${cleaned.slice(-4)}`;
  };

  const renderRating = (rating) => {
    if (!rating) return 'No rating';
    return '★'.repeat(Math.min(5, Math.floor(rating / 5))) + ` (${rating})`;
  };

  return (
    <div className="trading-floor">
      {/* Filter Bar */}
      <div className="filter-bar">
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={filters.sourceImageOnly}
            onChange={(e) => handleFilterChange('sourceImageOnly', e.target.checked)}
          />
          <span>Source Image Only</span>
        </label>

        <select 
          value={filters.location} 
          onChange={(e) => handleFilterChange('location', e.target.value)}
          className="filter-select"
        >
          <option value="">All Locations</option>
          <option value="North America">North America</option>
          <option value="Europe">Europe</option>
          <option value="Asia">Asia</option>
          <option value="South America">South America</option>
        </select>

        <select 
          value={filters.brand} 
          onChange={(e) => handleFilterChange('brand', e.target.value)}
          className="filter-select"
        >
          <option value="">All Brands</option>
          <option value="Omega">Omega</option>
          <option value="Rolex">Rolex</option>
          <option value="Audemars Piguet">Audemars Piguet</option>
          <option value="Patek Philippe">Patek Philippe</option>
          <option value="Richard Mille">Richard Mille</option>
        </select>

        <input
          type="text"
          placeholder="Reference"
          value={filters.reference}
          onChange={(e) => handleFilterChange('reference', e.target.value)}
          className="filter-input"
        />

        <select 
          value={filters.dial} 
          onChange={(e) => handleFilterChange('dial', e.target.value)}
          className="filter-select"
        >
          <option value="">All Dials</option>
          <option value="White">White</option>
          <option value="Black">Black</option>
          <option value="Blue">Blue</option>
          <option value="Salmon">Salmon</option>
        </select>

        <select 
          value={filters.sort} 
          onChange={(e) => handleFilterChange('sort', e.target.value)}
          className="filter-select"
        >
          <option value="newest">Newest First</option>
          <option value="price_low">Price: Low to High</option>
          <option value="price_high">Price: High to Low</option>
          <option value="rating">Highest Rated</option>
        </select>
      </div>

      {/* Listings Grid */}
      <div className="listings-grid">
        {listings.map((listing) => (
          <div 
            key={listing.id} 
            className="listing-card"
            onClick={() => setSelectedListing(listing)}
          >
            {/* Image */}
            <div className="listing-image">
              {listing.has_images && listing.thumbnail_url ? (
                <img src={listing.thumbnail_url} alt={listing.model} />
              ) : (
                <div className="no-image">No Image</div>
              )}
            </div>

            {/* Price */}
            <div className="listing-price">
              {formatPrice(listing.price_usd)}
            </div>

            {/* Title */}
            <div className="listing-title">
              {listing.brand} {listing.model}
            </div>

            {/* Reference */}
            <div className="listing-reference">
              {listing.reference}
            </div>

            {/* Dial */}
            <div className="listing-dial">
              {listing.dial_color} dial
            </div>

            {/* Seller Info */}
            <div className="listing-seller">
              <div className="seller-name">
                👤 {listing.seller_name || 'Anonymous'}
              </div>
              {listing.region && (
                <div className="seller-location">
                  📍 {listing.region}
                </div>
              )}
              <div className="seller-date">
                📅 {formatDate(listing.listing_date)}
              </div>
            </div>

            {/* View Details Button */}
            <button className="view-details-btn">
              View Details
            </button>
          </div>
        ))}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="loading-grid">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="listing-card skeleton">
              <div className="skeleton-image"></div>
              <div className="skeleton-text"></div>
              <div className="skeleton-text short"></div>
            </div>
          ))}
        </div>
      )}

      {/* Load More */}
      {hasMore && !loading && (
        <button 
          className="load-more-btn"
          onClick={() => setPage(prev => prev + 1)}
        >
          Load More
        </button>
      )}

      {/* Detail Modal */}
      {selectedListing && (
        <div className="detail-modal" onClick={() => setSelectedListing(null)}>
          <div className="detail-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setSelectedListing(null)}>×</button>
            
            {/* Large Image */}
            <div className="detail-image">
              {selectedListing.has_images && selectedListing.thumbnail_url ? (
                <img src={selectedListing.thumbnail_url} alt={selectedListing.model} />
              ) : (
                <div className="no-image-large">No Image Available</div>
              )}
            </div>

            {/* Raw Source - Moved to Top */}
            <div className="raw-source-section">
              <h3>Original Listing (Raw Source)</h3>
              <div className="raw-message">
                {selectedListing.raw_message || 'No raw message available'}
              </div>
              <div className="source-meta">
                Source: {selectedListing.source_file} | Row: {selectedListing.source_row_number}
              </div>
            </div>

            {/* Price */}
            <div className="detail-price">
              {formatPrice(selectedListing.price_usd)}
            </div>

            {/* Title */}
            <div className="detail-title">
              {selectedListing.brand} {selectedListing.model}
            </div>

            {/* Reference */}
            <div className="detail-reference">
              Reference: {selectedListing.reference}
            </div>

            {/* Dial */}
            <div className="detail-dial">
              Dial: {selectedListing.dial_color}
            </div>

            {/* Condition */}
            <div className="detail-condition">
              Condition: {selectedListing.condition}
            </div>

            {/* Seller Information */}
            <div className="seller-section">
              <h3>Seller Information</h3>
              <div className="seller-detail">
                <strong>Name:</strong> {selectedListing.seller_name || 'Anonymous'}
              </div>
              {selectedListing.region && (
                <div className="seller-detail">
                  <strong>Location:</strong> {selectedListing.region}
                </div>
              )}
              {selectedListing.seller_phone && (
                <div className="seller-detail">
                  <strong>Contact:</strong> {maskPhone(selectedListing.seller_phone)}
                </div>
              )}
              <div className="seller-detail">
                <strong>Posted:</strong> {formatDate(selectedListing.listing_date)}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="action-buttons">
              <button className="btn-primary">Check Availability</button>
              <button className="btn-secondary">View Seller Profile</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TradingFloor;
