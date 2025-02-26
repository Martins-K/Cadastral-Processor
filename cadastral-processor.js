// server.js (Node.js Express backend)
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });

// Serve static files
app.use(express.static('public'));

// Process Excel file route
app.post('/process', upload.single('excelFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const results = await processCadastralNumbers(filePath);
    
    // Generate output file
    const outputPath = path.join(__dirname, 'outputs', `cadastral_results_${Date.now()}.xlsx`);
    fs.mkdirSync(path.join(__dirname, 'outputs'), { recursive: true });
    
    // Create the output Excel file
    const newWorkbook = XLSX.utils.book_new();
    const newWorksheet = XLSX.utils.json_to_sheet(results, { skipHeader: true });
    newWorksheet['!cols'] = [{ wch: 30 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'Cadastral Results');
    XLSX.writeFile(newWorkbook, outputPath);
    
    // Clean up the uploaded file
    fs.unlinkSync(filePath);
    
    // Send the file path for download
    res.json({ 
      success: true, 
      message: 'Processing completed',
      downloadPath: `/download?file=${path.basename(outputPath)}`,
      totalProcessed: results.length - 1
    });
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ error: 'Failed to process file', details: error.message });
  }
});

// Download file route
app.get('/download', (req, res) => {
  const fileName = req.query.file;
  if (!fileName) {
    return res.status(400).send('File name is required');
  }
  
  const filePath = path.join(__dirname, 'outputs', fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }
  
  res.download(filePath);
});

async function processCadastralNumbers(inputFilePath) {
  const workbook = XLSX.readFile(inputFilePath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 'A' });
  
  const results = [
    {
      'Cadaster number': 'Cadaster number',
      'Cadaster designation number': 'Cadaster designation number',
    },
  ];
  
  // Set up headless Chrome driver
  const options = new chrome.Options();
  options.addArguments('--headless');
  options.addArguments('--disable-gpu');
  options.addArguments('--no-sandbox');
  
  const driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();
  
  try {
    for (let i = 1; i < data.length; i++) {
      const cadastralNumber = data[i].A;
      if (!cadastralNumber) continue;
      
      try {
        await driver.get('https://www.kadastrs.lv');
        
        // Click search button
        const searchButton = await driver.wait(
          until.elementLocated(By.xpath("//span[contains(text(),'Meklēt īpašumus')]")),
          10000
        );
        await searchButton.click();
        
        // Enter cadastral number
        const inputField = await driver.wait(
          until.elementLocated(By.xpath("//input[@id='cad_num']")),
          10000
        );
        await inputField.sendKeys(cadastralNumber);
        
        // Click search
        const submitButton = await driver.wait(
          until.elementLocated(By.xpath("//input[@value='Meklēt']")),
          10000
        );
        await submitButton.click();
        
        // Click on first result
        const firstResult = await driver.wait(
          until.elementLocated(By.xpath("//td[@class='cad_num']/a")),
          10000
        );
        await firstResult.click();
        
        // Wait for parcels table
        await driver.wait(
          until.elementLocated(By.id('parcels-tbody')),
          10000
        );
        
        // Get all cadastral designations
        const designationElements = await driver.findElements(By.xpath("//tbody[@id='parcels-tbody']//td[@class='cad_num']//a"));
        
        for (const element of designationElements) {
          const text = await element.getText();
          results.push({
            'Cadaster number': cadastralNumber,
            'Cadaster designation number': text,
          });
        }
        
        console.log(`Processed ${cadastralNumber}: Found ${designationElements.length} designations`);
      } catch (error) {
        console.error(`Error processing ${cadastralNumber}:`, error.message);
        results.push({
          'Cadaster number': cadastralNumber,
          'Cadaster designation number': 'Error: No results found',
        });
      }
    }
  } finally {
    await driver.quit();
  }
  
  return results;
}

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
