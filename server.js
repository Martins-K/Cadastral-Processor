const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");

// Add at the top of your file
process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ dest: "uploads/" });

let clients = []; // Store active connections for SSE

// Serve static files
app.use(express.static("public"));

// Create an example .xls file on server start (if it doesn't exist)
function createExampleXLS() {
  const exampleData = [["Cadastral Number"], ["1234567890"], ["0987654321"], ["1122334455"], ["5566778899"]];

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(exampleData);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Cadastral Numbers");

  const exampleFilePath = path.join(__dirname, "public", "example_cadastral_numbers.xls");
  if (!fs.existsSync(exampleFilePath)) {
    XLSX.writeFile(workbook, exampleFilePath);
    console.log(`Example .xls file created at: ${exampleFilePath}`);
  }
}

// Create example file when server starts
createExampleXLS();

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

// Route to download the example .xls file
app.get("/download-sample", (req, res) => {
  const exampleFilePath = path.join(__dirname, "public", "example_cadastral_numbers.xls");
  if (!fs.existsSync(exampleFilePath)) {
    return res.status(404).send("Example file not found.");
  }
  res.download(exampleFilePath, "example_cadastral_numbers.xls", (err) => {
    if (err) {
      console.error("Download error:", err);
      res.status(500).send("Error downloading example file.");
    }
  });
});

app.get("/download", (req, res) => {
  const fileName = req.query.file;
  const filePath = path.join(__dirname, "outputs", fileName); // Using the outputs directory

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return res.status(404).send("File not found.");
  }

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

  try {
    // Use Playwright's webkit instead of chromium as it might have better compatibility
    const { webkit } = require("playwright");

    const browser = await webkit.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto("https://www.kadastrs.lv");
      console.log("Navigated to kadastrs.lv");

      for (let i = 1; i < data.length; i++) {
        const cadastralNumber = data[i].A;
        if (!cadastralNumber) continue;

        try {
          // Navigate to properties page - use navigation promise to ensure completion
          console.log(`Processing cadastral number: ${cadastralNumber}`);
          await Promise.all([page.click('a.remote_menu[href="/properties"]')]);

          // Clear any existing text before filling
          await page.locator("#cad_num").clear();
          await page.locator("#cad_num").fill(`${cadastralNumber}`);
          console.log("Filled cadastral number input");

          // Use navigation promise for search action too
          await Promise.all([page.click("input[value='Meklēt']")]);

          // Check if we have results
          const hasResults = await page
            .waitForSelector("td.cad_num a", {
              state: "attached",
              timeout: 5000,
            })
            .then(() => true)
            .catch(() => false);
          console.log(`Results found: ${hasResults}`);

          if (hasResults) {
            // Click on the first result and wait for details page
            await Promise.all([page.click("td.cad_num a")]);

            // Wait for the table with designation numbers
            await page.waitForSelector("#parcels-tbody", { timeout: 10000 });

            const designationNumbers = await page.$$eval("#parcels-tbody td.cad_num a", (elements) =>
              elements.map((el) => el.textContent.trim())
            );

            if (designationNumbers.length > 0) {
              designationNumbers.forEach((text) => {
                results.push({
                  "Cadaster number": cadastralNumber,
                  "Cadaster designation number": text,
                });
              });
              console.log(`Found ${designationNumbers.length} designation numbers`);
            } else {
              results.push({
                "Cadaster number": cadastralNumber,
                "Cadaster designation number": "No designation numbers found",
              });
            }
          } else {
            results.push({
              "Cadaster number": cadastralNumber,
              "Cadaster designation number": "Error: No results found",
            });
          }
        } catch (error) {
          console.error(`Error processing ${cadastralNumber}:`, error.message);
          results.push({
            "Cadaster number": cadastralNumber,
            "Cadaster designation number": `Error: ${error.message}`,
          });

          // Recover from errors by going back to the home page
          try {
            await page.goto("https://www.kadastrs.lv");
            console.log("Recovered by navigating back to home page");
          } catch (navError) {
            console.error("Failed to recover:", navError.message);
          }
        }

        processed++;
        sendProgressUpdate(processed, totalEntries);

        // Add a small delay between requests to avoid overloading the server
        await page.waitForTimeout(1000);
      }
    } finally {
      await browser.close();
    }
  } catch (browserError) {
    console.error("Browser initialization error:", browserError);

    // Fall back to a simpler approach if browser automation fails
    console.log("Adding placeholder results due to browser initialization failure");

    // Add results indicating failure but at least providing something to the user
    for (let i = 1; i < data.length; i++) {
      const cadastralNumber = data[i].A;
      if (!cadastralNumber) continue;

      results.push({
        "Cadaster number": cadastralNumber,
        "Cadaster designation number": "Error: Browser automation failed - please try locally",
      });

      processed++;
      sendProgressUpdate(processed, totalEntries);
    }
  }

  return results;
}

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
