const { chromium } = require("playwright");

// Browser singleton
let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    console.log("Initializing new browser instance");
    try {
      // First approach: Try with specific browser configuration
      browserInstance = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined,
        ignoreDefaultArgs: ["--disable-extensions"],
      });
    } catch (error) {
      console.error("Failed to launch browser with first approach:", error);

      // Second approach: Set required environment variables
      process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
      process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";

      // Retry with different configuration
      browserInstance = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        channel: "chrome", // Try using system Chrome if available
      });
    }
  }
  return browserInstance;
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

module.exports = { getBrowser, closeBrowser };
