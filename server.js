const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const rateLimit = require('express-rate-limit');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

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
  max: 50,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api', limiter);

// Define robust selectors at the top
const graingerSelectors = [
  '[data-automation-id="product-tile"]',
  '.search-result',
  '.product-item',
  '.product-card',
  '.ProductTileContainer',
  '[class*="product"]',
  '[class*="tile"]',
  '[class*="result"]',
  '[role="listitem"]',
  'article',
  'li'
];
const mcmasterSelectors = [
  '.ProductTableRow',
  '.product-item',
  '.search-result',
  '.product',
  '[class*="product"]',
  '[class*="row"]',
  '[role="row"]',
  'tr'
];

// Enhanced multi-method scraper
async function searchGrainger(query, maxResults = 5) {
  console.log(`🔍 Starting multi-method search for: "${query}"`);
  
  // Method 1: Try with advanced headers
  let results = await tryAdvancedHeaders(query, maxResults);
  results = normalizeAndDeduplicate(results);
  if (results.length > 0) {
    console.log(`✅ Method 1 (Headers) succeeded: ${results.length} results`);
    return results;
  }
  
  // Method 2: Try with Puppeteer
  results = await tryPuppeteerMethod(query, maxResults);
  results = normalizeAndDeduplicate(results);
  if (results.length > 0) {
    console.log(`✅ Method 2 (Puppeteer) succeeded: ${results.length} results`);
    return results;
  }
  
  // Method 3: Try McMaster-Carr as backup
  results = await tryMcMasterCarr(query, maxResults);
  results = normalizeAndDeduplicate(results);
  if (results.length > 0) {
    console.log(`✅ Method 3 (McMaster) succeeded: ${results.length} results`);
    return results;
  }
  
  // Method 4: Return realistic sample data
  console.log(`⚠️ All methods failed, returning sample data for: "${query}"`);
  return getSampleDataForQuery(query);
}

// Method 1: Advanced headers with user agent rotation
async function tryAdvancedHeaders(query, maxResults) {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
  ];
  
  try {
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
    
    // Random delay to appear human
    await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 1000));
    
    const searchUrl = `https://www.grainger.com/search?searchQuery=${encodeURIComponent(query)}`;
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': randomUA,
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
        'DNT': '1',
        'Connection': 'keep-alive'
      },
      timeout: 20000,
      maxRedirects: 5
    });

    if (response.status === 200) {
      return parseGraingerHTML(response.data, query, maxResults);
    }
  } catch (error) {
    console.log('Method 1 failed:', error.message);
  }
  
  return [];
}

// Method 2: Puppeteer with stealth
async function tryPuppeteerMethod(query, maxResults) {
  let browser;
  let page;
  let attempt = 0;
  const maxAttempts = 3;
  const baseDelay = 2000;
  const searchUrl = `https://www.grainger.com/search?searchQuery=${encodeURIComponent(query)}`;

  while (attempt < maxAttempts) {
    try {
      console.log('🤖 Launching Puppeteer... (attempt', attempt + 1, ')');
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
          // '--proxy-server=YOUR_PROXY_URL', // Uncomment and set for proxy
        ]
      });
      page = await browser.newPage();
      await page.setViewport({ 
        width: 1366 + Math.floor(Math.random() * 200), 
        height: 768 + Math.floor(Math.random() * 200) 
      });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.resourceType() === 'image' || req.resourceType() === 'stylesheet') {
          req.abort();
        } else {
          req.continue();
        }
      });
      console.log(`🌐 Navigating to: ${searchUrl}`);
      await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 2000));
      await page.goto(searchUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      // Wait for product selector or timeout
      let foundSelector = null;
      for (const selector of graingerSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          foundSelector = selector;
          break;
        } catch (e) {
          // Try next selector
        }
      }
      if (!foundSelector) {
        throw new Error('No product selectors found on page');
      }
      // Extract data
      const results = await page.evaluate((maxResults, foundSelector) => {
        const products = [];
        const elements = document.querySelectorAll(foundSelector);
        for (let i = 0; i < Math.min(elements.length, maxResults); i++) {
          const elem = elements[i];
          const partNumber = elem.querySelector('[data-automation-id="product-item-number"], .product-number, .item-number')?.textContent?.trim() || '';
          const name = elem.querySelector('[data-automation-id="product-title"], .product-title, h3, h4')?.textContent?.trim() || '';
          const priceText = elem.querySelector('[data-automation-id="product-price"], .price, .product-price')?.textContent?.trim() || '';
          const availability = elem.querySelector('[data-automation-id="product-availability"], .availability')?.textContent?.trim() || 'Available';
          if (partNumber && name) {
            products.push({
              partNumber,
              name,
              priceText,
              availability,
              supplier: 'Grainger',
              source: 'Puppeteer'
            });
          }
        }
        return products;
      }, maxResults, foundSelector);
      const processedResults = results.map(part => ({
        ...part,
        price: parsePrice(part.priceText),
        inStock: !part.availability.toLowerCase().includes('out of stock'),
        productUrl: searchUrl,
        lastUpdated: new Date().toISOString()
      }));
      console.log(`✅ Puppeteer extracted ${processedResults.length} parts`);
      return processedResults;
    } catch (error) {
      console.error('Method 2 (Puppeteer) failed:', error.message);
      if (page) {
        try {
          const html = await page.content();
          require('fs').writeFileSync(`puppeteer_error_${Date.now()}.html`, html);
          await page.screenshot({ path: `puppeteer_error_${Date.now()}.png` });
        } catch (e) {
          console.error('Failed to save error HTML/screenshot:', e.message);
        }
      }
      attempt++;
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
        console.log(`Retrying Puppeteer in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
  return [];
}

// Method 3: McMaster-Carr backup
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
    
    // Try multiple selectors for McMaster
    for (const selector of mcmasterSelectors) {
      $(selector).each((index, element) => {
        if (index >= maxResults) return false;
        
        const $elem = $(element);
        const partNumber = $elem.find('.PartNumber, .part-number, [class*="part"]').text().trim();
        const name = $elem.find('.ProductDescription, .product-description, .description').text().trim();
        const priceText = $elem.find('.Price, .price, [class*="price"]').text().trim();
        
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
      
      if (results.length > 0) break;
    }
    
    console.log(`✅ McMaster-Carr found ${results.length} parts`);
    return results;
    
  } catch (error) {
    console.error('Method 3 (McMaster) failed:', error.message);
  }
  
  return [];
}

// Helper: Parse Grainger HTML
function parseGraingerHTML(html, query, maxResults) {
  const $ = cheerio.load(html);
  const results = [];
  for (const selector of graingerSelectors) {
    const products = $(selector);
    
    if (products.length > 0) {
      console.log(`📋 Parsing ${products.length} products with selector: ${selector}`);
      
      products.each((index, element) => {
        if (index >= maxResults) return false;
        
        const $elem = $(element);
        const partData = extractPartData($elem, $);
        
        if (partData && partData.partNumber && partData.name) {
          results.push(partData);
        }
      });
      break;
    }
  }
  
  return results;
}

// Extract part data from HTML element
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

// Sample data generator
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
        note: 'Sample data - scraping methods in progress'
      },
      {
        partNumber: '6203-RS',
        name: 'Timken Single Row Ball Bearing',
        price: 11.80,
        supplier: 'Grainger',
        inStock: true,
        availability: 'In Stock',
        productUrl: 'https://www.grainger.com',
        lastUpdated: new Date().toISOString(),
        note: 'Sample data - scraping methods in progress'
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
        note: 'Sample data - scraping methods in progress'
      }
    ];
  }
  
  if (lowerQuery.includes('bolt') || lowerQuery.includes('screw') || lowerQuery.includes('fastener')) {
    return [
      {
        partNumber: 'M8x25-HEX',
        name: 'Hex Head Cap Screw M8 x 25mm, Stainless Steel',
        price: 2.45,
        supplier: 'Grainger',
        inStock: true,
        availability: 'In Stock',
        productUrl: 'https://www.grainger.com',
        lastUpdated: new Date().toISOString(),
        note: 'Sample data - scraping methods in progress'
      }
    ];
  }
  
  return [
    {
      partNumber: 'IND-' + Math.random().toString(36).substr(2, 6).toUpperCase(),
      name: `Industrial Component for "${query}"`,
      price: Math.round((Math.random() * 50 + 10) * 100) / 100,
      supplier: 'Grainger',
      inStock: true,
      availability: 'In Stock',
      productUrl: 'https://www.grainger.com',
      lastUpdated: new Date().toISOString(),
      note: 'Sample data - scraping methods in progress'
    }
  ];
}

// Helper functions
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

// Add normalization and deduplication before returning results in searchGrainger
function normalizeAndDeduplicate(results) {
  const seen = new Set();
  return results.filter(item => {
    const key = `${item.supplier}|${item.partNumber}|${item.name}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    // Normalize price
    if (typeof item.price === 'string') item.price = parsePrice(item.price);
    // Normalize inStock
    if (typeof item.inStock !== 'boolean') item.inStock = parseAvailability(item.availability);
    // Normalize productUrl
    if (item.productUrl && !item.productUrl.startsWith('http')) {
      item.productUrl = `https://www.grainger.com${item.productUrl}`;
    }
    return true;
  });
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
    // Search with multi-method approach
    let results = await searchGrainger(query, parseInt(limit));
    
    // If no results, try cleaned query
    if (results.length === 0 || (results[0] && results[0].note)) {
      const cleanQuery = query.replace(/[-_\s]/g, '').replace(/^0+/, '');
      if (cleanQuery !== query && cleanQuery.length >= 2) {
        console.log(`🔄 Retrying with cleaned query: "${cleanQuery}"`);
        const retryResults = await searchGrainger(cleanQuery, parseInt(limit));
        if (retryResults.length > 0 && (!retryResults[0].note)) {
          results = retryResults;
        }
      }
    }
    
    res.json({ 
      results,
      query,
      cleanQuery: query.replace(/[-_\s]/g, '').replace(/^0+/, ''),
      resultCount: results.length,
      timestamp: new Date().toISOString(),
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
    version: '2.0.0',
    features: ['Multi-method scraping', 'Puppeteer', 'McMaster-Carr backup']
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Blue Collar AI Backend API - Multi-Method Scraper',
    version: '2.0.0',
    methods: ['Advanced Headers', 'Puppeteer Browser', 'McMaster-Carr Backup', 'Smart Fallback'],
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
  console.log(`🚀 Blue Collar AI Backend v2.0 running on port ${port}`);
  console.log(`📋 Health check: http://localhost:${port}/api/health`);
  console.log(`🔍 Search example: http://localhost:${port}/api/search?q=6203%20bearing`);
  console.log(`🎯 Multi-method scraping: Headers → Puppeteer → McMaster → Samples`);
});
