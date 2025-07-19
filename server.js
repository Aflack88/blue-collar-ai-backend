const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'https://your-frontend-domain.vercel.app'],
  credentials: true
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api', limiter);

// Enhanced Grainger scraper
async function searchGrainger(query, maxResults = 5) {
  try {
    console.log(`🔍 Searching Grainger for: "${query}"`);
    
    const searchUrl = `https://www.grainger.com/search?searchQuery=${encodeURIComponent(query)}`;
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 15000,
      maxRedirects: 5
    });

    const $ = cheerio.load(response.data);
    const results = [];

    // Multiple selectors to handle different Grainger page layouts
    const productSelectors = [
      '.search-result',
      '.product-item',
      '[data-automation-id="product-tile"]',
      '.product-tile',
      '.search-result-item'
    ];

    let foundProducts = false;

    for (const selector of productSelectors) {
      const products = $(selector);
      if (products.length > 0) {
        foundProducts = true;
        console.log(`Found ${products.length} products with selector: ${selector}`);
        
        products.each((index, element) => {
          if (index >= maxResults) return false;
          
          const $elem = $(element);
          const partData = extractPartData($elem, $);
          
          if (partData && partData.partNumber && partData.name) {
            results.push(partData);
          }
        });
        break; // Use first working selector
      }
    }

    if (!foundProducts) {
      console.log('⚠️ No products found with standard selectors, trying fallback...');
      // Fallback: look for any elements with part numbers
      $('*').each((index, element) => {
        if (results.length >= maxResults) return false;
        
        const text = $(element).text().trim();
        // Look for part number patterns
        if (/^[A-Z0-9\-]{4,}$/.test(text) && text.length < 20) {
          results.push({
            partNumber: text,
            name: `Part ${text}`,
            price: null,
            supplier: 'Grainger',
            inStock: true,
            availability: 'Check with supplier',
            productUrl: searchUrl,
            lastUpdated: new Date().toISOString()
          });
        }
      });
    }

    console.log(`✅ Found ${results.length} parts from Grainger`);
    return results;

  } catch (error) {
    console.error('❌ Grainger search error:', error.message);
    
    // Return sample data as fallback
    if (query.toLowerCase().includes('bearing')) {
      return [{
        partNumber: '6203-2Z',
        name: 'Deep Groove Ball Bearing (Sample Data)',
        price: 12.45,
        supplier: 'Grainger',
        inStock: true,
        availability: 'Sample - Check Grainger directly',
        productUrl: 'https://www.grainger.com',
        lastUpdated: new Date().toISOString(),
        note: 'Sample data - scraping may need adjustment'
      }];
    }
    
    return [];
  }
}

function extractPartData($elem, $) {
  try {
    // Try multiple selectors for part number
    const partNumberSelectors = [
      '[data-automation-id="product-item-number"]',
      '.product-number',
      '.item-number',
      '.part-number',
      '[class*="item-number"]',
      '[class*="part-number"]'
    ];

    let partNumber = '';
    for (const selector of partNumberSelectors) {
      partNumber = $elem.find(selector).text().trim();
      if (partNumber) break;
    }

    // Try multiple selectors for product name
    const nameSelectors = [
      '[data-automation-id="product-title"]',
      '.product-title',
      '.product-name',
      'h3',
      'h4',
      '[class*="title"]'
    ];

    let name = '';
    for (const selector of nameSelectors) {
      name = $elem.find(selector).text().trim();
      if (name && name.length > 3) break;
    }

    // Try multiple selectors for price
    const priceSelectors = [
      '[data-automation-id="product-price"]',
      '.price',
      '.product-price',
      '[class*="price"]',
      '.cost'
    ];

    let priceText = '';
    for (const selector of priceSelectors) {
      priceText = $elem.find(selector).text().trim();
      if (priceText && priceText.includes('$')) break;
    }

    const price = parsePrice(priceText);

    // Try multiple selectors for availability
    const availabilitySelectors = [
      '[data-automation-id="product-availability"]',
      '.availability',
      '.stock-status',
      '[class*="availability"]'
    ];

    let availability = '';
    for (const selector of availabilitySelectors) {
      availability = $elem.find(selector).text().trim();
      if (availability) break;
    }

    const productUrl = $elem.find('a').first().attr('href');
    const fullUrl = productUrl && productUrl.startsWith('http') 
      ? productUrl 
      : productUrl 
        ? `https://www.grainger.com${productUrl}`
        : null;

    return {
      partNumber: partNumber || 'N/A',
      name: name || 'Product Name Not Found',
      price: price,
      priceText: priceText,
      availability: availability || 'Check with supplier',
      inStock: parseAvailability(availability),
      supplier: 'Grainger',
      productUrl: fullUrl,
      lastUpdated: new Date().toISOString()
    };

  } catch (error) {
    console.error('Error extracting part data:', error);
    return null;
  }
}

function parsePrice(priceText) {
  if (!priceText) return null;
  const match = priceText.match(/\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  return match ? parseFloat(match[1].replace(/,/g, '')) : null;
}

function parseAvailability(availabilityText) {
  if (!availabilityText) return true;
  const text = availabilityText.toLowerCase();
  return !text.includes('out of stock') && !text.includes('discontinued');
}

// API Routes
app.get('/api/search', async (req, res) => {
  const { q: query, limit = 5 } = req.query;
  
  if (!query || query.trim().length < 2) {
    return res.status(400).json({ 
      error: 'Query parameter must be at least 2 characters',
      example: '/api/search?q=6203%20bearing'
    });
  }

  console.log(`🔍 API Search request: "${query}"`);
  
  try {
    // Search Grainger
    let results = await searchGrainger(query, parseInt(limit));
    
    // If no results, try cleaned query
    if (results.length === 0) {
      const cleanQuery = query.replace(/[-_\s]/g, '').replace(/^0+/, '');
      if (cleanQuery !== query && cleanQuery.length >= 2) {
        console.log(`🔄 Retrying with cleaned query: "${cleanQuery}"`);
        results = await searchGrainger(cleanQuery, parseInt(limit));
      }
    }
    
    res.json({ 
      results,
      query,
      cleanQuery: query.replace(/[-_\s]/g, '').replace(/^0+/, ''),
      resultCount: results.length,
      timestamp: new Date().toISOString(),
      source: 'Grainger'
    });
    
  } catch (error) {
    console.error('❌ Search API error:', error);
    res.status(500).json({ 
      error: 'Search failed', 
      message: error.message,
      query,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '1.0.0'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Blue Collar AI Backend API',
    version: '1.0.0',
    endpoints: {
      search: '/api/search?q=YOUR_QUERY',
      health: '/api/health'
    },
    example: '/api/search?q=6203%20bearing'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Blue Collar AI Backend running on port ${port}`);
  console.log(`📋 Health check: http://localhost:${port}/api/health`);
  console.log(`🔍 Search example: http://localhost:${port}/api/search?q=6203%20bearing`);
});
