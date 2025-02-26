const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ dest: "uploads/" });

let clients = []; // Store active connections for SSE

// Serve static files
app.use(express.static("public"));

// SSE endpoint to send progress updates
app.get("/progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  clients.push(res);

  req.on("close", () => {
    clients = clients.filter((client) => client !== res);
  });
});

// Function to send progress updates
function sendProgressUpdate(progress, total) {
  clients.forEach((client) => {
    client.write(`data: ${JSON.stringify({ progress, total })}\n\n`);
  });
}

// Process Excel file route
app.post("/process", upload.single("excelFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const results = await processCadastralNumbers(filePath);

    // Generate output file
    const outputPath = path.join(__dirname, "outputs", `cadastral_results_${Date.now()}.xlsx`);
    fs.mkdirSync(path.join(__dirname, "outputs"), { recursive: true });

    // Create the output Excel file
    const newWorkbook = XLSX.utils.book_new();
    const newWorksheet = XLSX.utils.json_to_sheet(results, { skipHeader: true });
    newWorksheet["!cols"] = [{ wch: 30 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, "Cadastral Results");
    XLSX.writeFile(newWorkbook, outputPath);

    // Clean up the uploaded file
    fs.unlinkSync(filePath);

    // Notify completion
    sendProgressUpdate(results.length - 1, results.length - 1);

    res.json({
      success: true,
      message: "Processing completed",
      downloadPath: `/download?file=${path.basename(outputPath)}`,
      totalProcessed: results.length - 1,
    });
  } catch (error) {
    console.error("Error processing file:", error);
    res.status(500).json({ error: "Failed to process file", details: error.message });
  }
});

app.get("/download", (req, res) => {
  const fileName = req.query.file;
  const filePath = path.join(__dirname, "uploads", fileName); // Ensure this path matches your storage folder

  res.download(filePath, (err) => {
    if (err) {
      console.error("Download error:", err);
      res.status(500).send("Error downloading file.");
    }
  });
});

// Function to process cadastral numbers
async function processCadastralNumbers(inputFilePath) {
  const workbook = XLSX.readFile(inputFilePath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: "A" });

  const results = [
    {
      "Cadaster number": "Cadaster number",
      "Cadaster designation number": "Cadaster designation number",
    },
  ];

  const totalEntries = data.length - 1;
  let processed = 0;

  const options = new chrome.Options();
  options.addArguments("--headless", "--disable-gpu", "--no-sandbox");

  const driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();

  try {
    for (let i = 1; i < data.length; i++) {
      const cadastralNumber = data[i].A;
      if (!cadastralNumber) continue;

      try {
        await driver.get("https://www.kadastrs.lv");

        const searchButton = await driver.wait(
          until.elementLocated(By.xpath("//span[contains(text(),'Meklēt īpašumus')]")),
          10000
        );
        await searchButton.click();

        const inputField = await driver.wait(until.elementLocated(By.xpath("//input[@id='cad_num']")), 10000);
        await inputField.sendKeys(cadastralNumber);

        const submitButton = await driver.wait(until.elementLocated(By.xpath("//input[@value='Meklēt']")), 10000);
        await submitButton.click();

        const firstResult = await driver.wait(until.elementLocated(By.xpath("//td[@class='cad_num']/a")), 10000);
        await firstResult.click();

        await driver.wait(until.elementLocated(By.id("parcels-tbody")), 10000);

        const designationElements = await driver.findElements(By.xpath("//tbody[@id='parcels-tbody']//td[@class='cad_num']//a"));

        for (const element of designationElements) {
          const text = await element.getText();
          results.push({
            "Cadaster number": cadastralNumber,
            "Cadaster designation number": text,
          });
        }
      } catch (error) {
        results.push({
          "Cadaster number": cadastralNumber,
          "Cadaster designation number": "Error: No results found",
        });
      }

      processed++;
      sendProgressUpdate(processed, totalEntries);
    }
  } finally {
    await driver.quit();
  }

  return results;
}

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
