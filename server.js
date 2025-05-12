import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import XLSX from "xlsx";
import { chromium } from "playwright";
import sendEmail from "./sendMail.js";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ dest: "uploads/" });
let clients = [];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.static("public"));

app.use((req, res, next) => {
  console.log(`Request URL: ${req.url}`);
  next();
});

app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "favicon.ico"));
});

function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

function createExampleXLS() {
  const exampleData = [["Cadastral Number"], ["1234567890"], ["0987654321"]];
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(exampleData);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Cadastral Numbers");
  const exampleFilePath = path.join(__dirname, "public", "example_cadastral_numbers.xls");
  if (!fs.existsSync(exampleFilePath)) {
    XLSX.writeFile(workbook, exampleFilePath);
    console.log(`Example .xls file created at: ${exampleFilePath}`);
  }
}
createExampleXLS();

app.get("/progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  clients.push(res);
  req.on("close", () => {
    clients = clients.filter((client) => client !== res);
  });
});

function sendProgressUpdate(progress, total) {
  clients.forEach((client) => {
    client.write(`data: ${JSON.stringify({ progress, total })}\n\n`);
  });
}

app.post("/process", upload.single("excelFile"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = req.file.path;
    const originalName = req.file.originalname;

    const parsedPath = path.parse(originalName);
    const baseName = parsedPath.name;
    const extension = parsedPath.ext;

    const outputFilename = `${baseName}_processed${extension}`;

    const outputPath = path.join(__dirname, "outputs", outputFilename);

    fs.mkdirSync(path.join(__dirname, "outputs"), { recursive: true });

    const results = await processCadastralNumbers(filePath);

    const newWorkbook = XLSX.utils.book_new();
    const newWorksheet = XLSX.utils.json_to_sheet(results, { skipHeader: true });
    newWorksheet["!cols"] = [{ wch: 30 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, "Cadastral Results");
    XLSX.writeFile(newWorkbook, outputPath);

    fs.unlinkSync(filePath);

    sendProgressUpdate(results.length - 1, results.length - 1);

    // Send email with attachment (using the new filename)
    try {
      await sendEmail(
        "Cadastral Processing Completed",
        `Your cadastral number processing has completed for file: ${originalName}.\nTotal processed: ${results.length - 1}`,
        outputPath,
        outputFilename
      );
      console.log("Email sent successfully!");
    } catch (emailError) {
      console.error("Error sending email:", emailError);
      //  IMPORTANT:  Handle the email sending error.  
      //  You might want to log this to a file, or inform the user.
      //  For now, we'll just log it and continue.  **Don't just swallow the error!**
    }


    res.json({
      success: true,
      message: "Processing completed",
      downloadPath: `/download?file=${encodeURIComponent(outputFilename)}`,
      totalProcessed: results.length - 1,
    });
  } catch (error) {
    console.error("Error:", error);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error("Error cleaning up uploaded file:", cleanupError);
      }
    }
    res.status(500).json({ error: "Processing failed", details: error.message });
  }
});

app.get("/download-sample", (req, res) => {
  const file = path.join(__dirname, "public", "example_cadastral_numbers.xls");
  if (!fs.existsSync(file)) return res.status(404).send("Example not found");
  res.download(file);
});

app.get("/download", (req, res) => {
  const file = path.join(__dirname, "outputs", req.query.file);
  if (!fs.existsSync(file)) return res.status(404).send("File not found");
  res.download(file);
});

async function processCadastralNumbers(inputFilePath) {
  console.time("ProcessingTime");
  const workbook = XLSX.readFile(inputFilePath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: "A" });

  const rows = data.slice(1).filter(row => row.A);
  const batchSize = 10;
  const chunks = chunkArray(rows, batchSize);
  const results = [{
    "Cadaster number": "Cadaster number",
    "Cadaster designation number": "Cadaster designation number",
  }];
  const totalEntries = rows.length;
  let processed = 0;

  for (const chunk of chunks) {
    const batchResults = await Promise.all(chunk.map(async ({ A: cadastralNumber }) => {
      try {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto("https://www.kadastrs.lv");
        await page.click('a.remote_menu[href="/properties"]');
        await page.locator("#cad_num").fill(`${cadastralNumber}`);
        await page.click("input[value='Meklēt']");

        const hasResults = await page.waitForSelector("td.cad_num a", { timeout: 5000 }).then(() => true).catch(() => false);
        let entryResults = [];

        if (hasResults) {
          await page.click("td.cad_num a");
          await page.waitForSelector("#parcels-tbody", { timeout: 10000 });
          const designationNumbers = await page.$$eval("#parcels-tbody td.cad_num a", els => els.map(el => el.textContent.trim()));
          entryResults = designationNumbers.length
            ? designationNumbers.map(text => ({ "Cadaster number": cadastralNumber, "Cadaster designation number": text }))
            : [{ "Cadaster number": cadastralNumber, "Cadaster designation number": "No designation numbers found" }];
        } else {
          entryResults.push({ "Cadaster number": cadastralNumber, "Cadaster designation number": "Error: No results found" });
        }

        await browser.close();
        return entryResults;
      } catch (err) {
        return [{ "Cadaster number": cadastralNumber, "Cadaster designation number": `Error: ${err.message}` }];
      } finally {
        processed++;
        sendProgressUpdate(processed, totalEntries);
      }
    }));
    results.push(...batchResults.flat());
  }

  console.timeEnd("ProcessingTime");
  return results;
}



app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
