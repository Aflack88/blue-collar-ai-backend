const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://blue-collar-buddy-91j5.vercel.app',
    'https://*.vercel.app'
  ],
  credentials: true
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Increased limit
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api', limiter);

// Multi-method scraper (without Puppeteer)
async function searchGrainger(query, maxResults = 5) {
  console.log(`🔍 Starting search for: "${query}"`);
  
  // Method 1: Advanced headers with rotation
  let results = await tryAdvancedScraping(query, maxResults);
  if (results.length > 0) {
    console.log(`✅ Method 1 succeeded: ${results.length} results`);
    return results;
  }
  
  // Method 2: Try McMaster-Carr
  results = await tryMcMasterCarr(query, maxResults);
  if (results.length > 0) {
    console.log(`✅ Method 2 (McMaster) succeeded: ${results.length} results`);
    return results;
  }
  
  // Method 3: Try Fastenal
  results = await tryFastenal(query, maxResults);
  if (results.length > 0) {
    console.log(`✅ Method 3 (Fastenal) succeeded: ${results.length} results`);
    return results;
  }
  
  // Method 4: Return smart sample data
  console.log(`⚠️ All scraping failed, returning sample data for: "${query}"`);
  return getSampleDataForQuery(query);
}

// Method 1: Advanced scraping with multiple attempts
async function tryAdvancedScraping(query, maxResults) {
  const attempts = [
    () => scrapeGraingerMethod1(query, maxResults),
    () => scrapeGraingerMethod2(query, maxResults),
    () => scrapeGraingerMethod3(query, maxResults)
  ];
  
  for (let i = 0; i < attempts.length; i++) {
    try {
      console.log(`🔄 Grainger attempt ${i + 1}/3`);
      const results = await attempts[i]();
      if (results.length > 0) {
        return results;
      }
      // Wait between attempts
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.log(`Attempt ${i + 1} failed:`, error.message);
    }
  }
  
  return [];
}

// Grainger Method 1: Mobile User Agent
async function scrapeGraingerMethod1(query, maxResults) {
  const searchUrl = `https://www.grainger.com/search?searchQuery=${encodeURIComponent(query)}`;
  
  const response = await axios.get(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    },
    timeout: 15000
  });

  return parseGraingerResponse(response.data, query);
}

// Grainger Method 2: Desktop Chrome
async function scrapeGraingerMethod2(query, maxResults) {
  const searchUrl = `https://www.grainger.com/search?searchQuery=${encodeURIComponent(query)}`;
  
  // Random delay
  await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 1000));
  
  const response = await axios.get(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'DNT': '1'
    },
    timeout: 20000
  });

  return parseGraingerResponse(response.data, query);
}

// Grainger Method 3: Firefox
async function scrapeGraingerMethod3(query, maxResults) {
  const searchUrl = `https://www.grainger.com/search?searchQuery=${encodeURIComponent(query)}`;
  
  // Random delay
  await new Promise(resolve => setTimeout(resolve, Math.random() * 4000 + 2000));
  
  const response = await axios.get(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    },
    timeout: 20000
  });

  return parseGraingerResponse(response.data, query);
}

// Parse Grainger response
function parseGraingerResponse(html, query) {
  const $ = cheerio.load(html);
  const results = [];
  
  // Multiple selectors for different page layouts
  const selectors = [
    '[data-automation-id="product-tile"]',
    '.search-result',
    '.product-item',
    '.product-card',
    '.ProductTileContainer',
    '.product-listing-item'
  ];
  
  for (const selector of selectors) {
    const products = $(selector);
    
    if (products.length > 0) {
      console.log(`📋 Found ${products.length} products with selector: ${selector}`);
      
      products.each((index, element) => {
        if (index >= 5) return false; // Limit results
        
        const $elem = $(element);
        
        // Extract part data with multiple fallbacks
        const partNumber = extractText($elem, [
          '[data-automation-id="product-item-number"]',
          '.product-number',
          '.item-number',
          '.part-number',
          '[class*="item-number"]'
        ]);
        
        const name = extractText($elem, [
          '[data-automation-id="product-title"]',
          '.product-title',
          '.product-name',
          'h3',
          'h4',
          '[class*="title"]'
        ]);
        
        const priceText = extractText($elem, [
          '[data-automation-id="product-price"]',
          '.price',
          '.product-price',
          '[class*="price"]'
        ]);
        
        const availability = extractText($elem, [
          '[data-automation-id="product-availability"]',
          '.availability',
          '.stock-status'
        ]) || 'Available';
        
        if (partNumber && name && partNumber.length > 2 && name.length > 5) {
          results.push({
            partNumber: partNumber.replace(/[^\w\-]/g, ''), // Clean part number
            name: name.substring(0, 200), // Limit name length
            price: parsePrice(priceText),
            priceText: priceText,
            availability: availability,
            inStock: !availability.toLowerCase().includes('out of stock'),
            supplier: 'Grainger',
            productUrl: `https://www.grainger.com/search?searchQuery=${encodeURIComponent(query)}`,
            lastUpdated: new Date().toISOString(),
            source: 'Grainger-Advanced'
          });
        }
      });
      
      if (results.length > 0) break; // Use first working selector
    }
  }
  
  return results;
}

// Helper function to extract text with multiple selectors
function extractText($elem, selectors) {
  for (const selector of selectors) {
    const text = $elem.find(selector).text().trim();
    if (text && text.length > 0) {
      return text;
    }
  }
  return '';
}

// Method 2: McMaster-Carr
async function tryMcMasterCarr(query, maxResults) {
  try {
    console.log(`🔧 Trying McMaster-Carr for: "${query}"`);
    
    const searchUrl = `https://www.mcmaster.com/search?query=${encodeURIComponent(query)}`;
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const results = [];
    
    // McMaster has a more structured layout
    $('.ProductTableRow, .product-item, .search-result').each((index, element) => {
      if (index >= maxResults) return false;
      
      const $elem = $(element);
      const partNumber = $elem.find('.PartNumber, .part-number').text().trim();
      const name = $elem.find('.ProductDescription, .product-description').text().trim();
      const priceText = $elem.find('.Price, .price').text().trim();
      
      if (partNumber && name) {
        results.push({
          partNumber,
          name,
          price: parsePrice(priceText),
          priceText,
          supplier: 'McMaster-Carr',
          inStock: true,
          availability: 'Available',
          productUrl: 'https://www.mcmaster.com',
          lastUpdated: new Date().toISOString(),
          source: 'McMaster'
        });
      }
    });
    
    return results;
    
  } catch (error) {
    console.log('McMaster-Carr failed:', error.message);
  }
  
  return [];
}

// Method 3: Fastenal
async function tryFastenal(query, maxResults) {
  try {
    console.log(`🔩 Trying Fastenal for: "${query}"`);
    
    const searchUrl = `https://www.fastenal.com/search?query=${encodeURIComponent(query)}`;
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const results = [];
    
    $('.product-item, .search-result, .product').each((index, element) => {
      if (index >= maxResults) return false;
      
      const $elem = $(element);
      const partNumber = $elem.find('.part-number, .product-number').text().trim();
      const name = $elem.find('.product-name, .description').text().trim();
      const priceText = $elem.find('.price').text().trim();
      
      if (partNumber && name) {
        results.push({
          partNumber,
          name,
          price: parsePrice(priceText),
          priceText,
          supplier: 'Fastenal',
          inStock: true,
          availability: 'Available',
          productUrl: 'https://www.fastenal.com',
          lastUpdated: new Date().toISOString(),
          source: 'Fastenal'
        });
      }
    });
    
    return results;
    
  } catch (error) {
    console.log('Fastenal failed:', error.message);
  }
  
  return [];
}

// Smart sample data generator
function getSampleDataForQuery(query) {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('bearing') || lowerQuery.includes('6203')) {
    return [
      {
        partNumber: '6203-2Z',
        name: 'SKF Deep Groove Ball Bearing - 6203-2Z',
        price: 12.45,
        supplier: 'Grainger',
        inStock: true,
        availability: 'In Stock',
        productUrl: 'https://www.grainger.com',
        lastUpdated: new Date().toISOString(),
        note: 'Sample data - real scraping in progress'
      },
      {
        partNumber: '6203-RS',
        name: 'Timken Single Row Ball Bearing',
        price: 11.80,
        supplier: 'McMaster-Carr',
        inStock: true,
        availability: 'In Stock',
        productUrl: 'https://www.mcmaster.com',
        lastUpdated: new Date().toISOString(),
        note: 'Sample data - real scraping in progress'
      }
    ];
  }
  
  if (lowerQuery.includes('seal') || lowerQuery.includes('hydraulic')) {
    return [
      {
        partNumber: 'CR-25x35x7',
        name: 'Hydraulic Oil Seal 25x35x7mm',
        price: 15.60,
        supplier: 'Grainger',
        inStock: true,
        availability: 'In Stock',
        productUrl: 'https://www.grainger.com',
        lastUpdated: new Date().toISOString(),
        note: 'Sample data - real scraping in progress'
      },
      {
        partNumber: 'VS-40x52x7',
        name: 'Valve Stem Seal 40x52x7mm',
        price: 18.25,
        supplier: 'Fastenal',
        inStock: true,
        availability: 'In Stock',
        productUrl: 'https://www.fastenal.com',
        lastUpdated: new Date().toISOString(),
        note: 'Sample data - real scraping in progress'
      }
    ];
  }
  
  if (lowerQuery.includes('bolt') || lowerQuery.includes('screw') || lowerQuery.includes('fastener')) {
    return [
      {
        partNumber: 'M8x25-HEX',
        name: 'Hex Head Cap Screw M8 x 25mm, Stainless Steel',
        price: 2.45,
        supplier: 'Fastenal',
        inStock: true,
        availability: 'In Stock',
        productUrl: 'https://www.fastenal.com',
        lastUpdated: new Date().toISOString(),
        note: 'Sample data - real scraping in progress'
      },
      {
        partNumber: '1/4-20x1',
        name: 'Socket Head Cap Screw 1/4-20 x 1", Alloy Steel',
        price: 1.95,
        supplier: 'McMaster-Carr',
        inStock: true,
        availability: 'In Stock',
        productUrl: 'https://www.mcmaster.com',
        lastUpdated: new Date().toISOString(),
        note: 'Sample data - real scraping in progress'
      }
    ];
  }
  
  return [
    {
      partNumber: 'IND-' + Math.random().toString(36).substr(2, 6).toUpperCase(),
      name: `Industrial Component for "${query}"`,
      price: Math.round((Math.random() * 50 + 10) * 100) / 100,
      supplier: Math.random() > 0.5 ? 'Grainger' : 'McMaster-Carr',
      inStock: Math.random() > 0.2,
      availability: Math.random() > 0.2 ? 'In Stock' : '2-3 Day Lead Time',
      productUrl: 'https://www.grainger.com',
      lastUpdated: new Date().toISOString(),
      note: 'Sample data - real scraping in progress'
    }
  ];
}

// Helper function
function parsePrice(priceText) {
  if (!priceText) return null;
  const match = priceText.match(/\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  return match ? parseFloat(match[1].replace(/,/g, '')) : null;
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
    let results = await searchGrainger(query, parseInt(limit));
    
    res.json({ 
      results,
      query,
      resultCount: results.length,
      timestamp: new Date().toISOString(),
      methods: ['Grainger-Multi', 'McMaster-Carr', 'Fastenal', 'Smart-Samples'],
      source: results.length > 0 ? results[0].supplier : 'Multiple'
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
    version: '2.1.0-lightweight',
    features: ['Multi-method scraping', 'McMaster-Carr', 'Fastenal', 'Smart samples']
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Blue Collar AI Backend API - Lightweight Multi-Scraper',
    version: '2.1.0',
    methods: ['Grainger Multi-Method', 'McMaster-Carr', 'Fastenal', 'Smart Fallback'],
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
  console.log(`🚀 Blue Collar AI Backend v2.1 (Lightweight) running on port ${port}`);
  console.log(`📋 Health check: http://localhost:${port}/api/health`);
  console.log(`🔍 Search example: http://localhost:${port}/api/search?q=6203%20bearing`);
  console.log(`🎯 Multi-source scraping: Grainger → McMaster → Fastenal → Samples`);
});
