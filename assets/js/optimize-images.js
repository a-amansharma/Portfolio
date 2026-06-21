const sharp = require("sharp");
const chokidar = require("chokidar");
const fs = require("fs");
const path = require("path");
const heicConvert = require("heic-convert");

const ROOT_FOLDER = path.join(__dirname, "../../images");
const TRACK_FILE = path.join(ROOT_FOLDER, ".optimized-images.json");

const QUALITY = 80;

const allowedExtensions = [
  ".jpg", ".jpeg", ".png", ".webp",
  ".heic", ".heif", ".avif", ".tiff", ".tif"
];

let optimizedMap = {};

if (fs.existsSync(TRACK_FILE)) {
  try {
    optimizedMap = JSON.parse(fs.readFileSync(TRACK_FILE, "utf8"));
  } catch {
    optimizedMap = {};
  }
}

function saveTrackFile() {
  fs.writeFileSync(TRACK_FILE, JSON.stringify(optimizedMap, null, 2));
}

function isImage(filePath) {
  return allowedExtensions.includes(path.extname(filePath).toLowerCase());
}

function isInsideOriginalFolder(filePath) {
  return filePath.split(path.sep).includes("original");
}

function getSignature(filePath) {
  const stat = fs.statSync(filePath);
  return `${stat.size}-${stat.mtimeMs}`;
}

function cleanBaseName(filePath) {
  let base = path.basename(filePath);

  while (allowedExtensions.includes(path.extname(base).toLowerCase())) {
    base = path.basename(base, path.extname(base));
  }

  return base;
}

function getUniqueBackupPath(originalFolder, fileName) {
  let backupPath = path.join(originalFolder, fileName);

  if (!fs.existsSync(backupPath)) return backupPath;

  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let count = 1;

  while (fs.existsSync(backupPath)) {
    backupPath = path.join(originalFolder, `${base}-${count}${ext}`);
    count++;
  }

  return backupPath;
}

async function getSharpInput(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".heic" || ext === ".heif") {
    const inputBuffer = fs.readFileSync(filePath);

    const pngBuffer = await heicConvert({
      buffer: inputBuffer,
      format: "PNG",
      quality: 1
    });

    return sharp(Buffer.from(pngBuffer), {
      failOn: "none",
      limitInputPixels: false
    }).rotate();
  }

  return sharp(filePath, {
    failOn: "none",
    limitInputPixels: false
  }).rotate();
}

async function optimizeImage(filePath) {
  if (!isImage(filePath)) return;
  if (!fs.existsSync(filePath)) return;
  if (isInsideOriginalFolder(filePath)) return;
  if (path.basename(filePath) === ".optimized-images.json") return;

  const folder = path.dirname(filePath);
  const cleanName = cleanBaseName(filePath);

  const outputPath = path.join(folder, `${cleanName}.webp`);
  const tempPath = path.join(folder, `${cleanName}.temp.webp`);
  const originalFolder = path.join(folder, "original");

  if (filePath === outputPath) {
    console.log(`⏭ Already clean WebP: ${outputPath}`);
    return;
  }

  const relativeOutput = path.relative(ROOT_FOLDER, outputPath);
  const currentSignature = getSignature(filePath);

  if (
    optimizedMap[relativeOutput] === currentSignature &&
    fs.existsSync(outputPath)
  ) {
    console.log(`⏭ Already optimized: ${outputPath}`);
    return;
  }

  try {
    const image = await getSharpInput(filePath);

    await image
      .webp({
        quality: QUALITY,
        effort: 6
      })
      .toFile(tempPath);

    fs.renameSync(tempPath, outputPath);

    if (!fs.existsSync(originalFolder)) {
      fs.mkdirSync(originalFolder);
    }

    const backupPath = getUniqueBackupPath(
      originalFolder,
      path.basename(filePath)
    );

    fs.renameSync(filePath, backupPath);

    optimizedMap[relativeOutput] = getSignature(outputPath);
    saveTrackFile();

    console.log(`✅ Converted: ${outputPath}`);
    console.log(`📦 Original moved to: ${backupPath}`);
  } catch (error) {
    console.log(`❌ Error: ${filePath}`);
    console.log(error.message);

    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

async function scanExistingImages(folder) {
  const items = fs.readdirSync(folder, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(folder, item.name);

    if (item.isDirectory()) {
      if (item.name === "original") continue;
      await scanExistingImages(fullPath);
    } else {
      await optimizeImage(fullPath);
    }
  }
}

if (!fs.existsSync(ROOT_FOLDER)) {
  console.log("❌ images folder not found");
  process.exit();
}

console.log("🚀 Scanning all images...");
scanExistingImages(ROOT_FOLDER);

console.log("👀 Watching for new images...");

chokidar
  .watch(ROOT_FOLDER, {
    ignored: /(^|[/\\])original([/\\]|$)/,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100
    }
  })
  .on("add", optimizeImage)
  .on("change", optimizeImage);