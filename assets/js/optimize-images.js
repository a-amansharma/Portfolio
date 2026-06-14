const sharp = require("sharp");
const chokidar = require("chokidar");
const fs = require("fs");
const path = require("path");

const ROOT_FOLDER = path.join(__dirname, "../../images");
const TRACK_FILE = path.join(ROOT_FOLDER, ".optimized-images.json");

const QUALITY = 80;

const INDEX_MAX_WIDTH = 1600;
const DESIGN_MAX_WIDTH = 1600;

const PORTRAIT_WIDTH = 900;
const PORTRAIT_HEIGHT = 1200;

const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"];

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

function getTopFolder(filePath) {
  const relativePath = path.relative(ROOT_FOLDER, filePath);
  return relativePath.split(path.sep)[0];
}

function isDirectIndexImage(filePath) {
  return path.dirname(filePath) === ROOT_FOLDER;
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

async function optimizeImage(filePath) {
  if (!isImage(filePath)) return;
  if (!fs.existsSync(filePath)) return;
  if (isInsideOriginalFolder(filePath)) return;
  if (path.basename(filePath) === ".optimized-images.json") return;

  const ext = path.extname(filePath).toLowerCase();
  const folder = path.dirname(filePath);
  const fileName = path.basename(filePath, ext);

  const outputPath = path.join(folder, `${fileName}.webp`);
  const tempPath = path.join(folder, `${fileName}.temp.webp`);
  const originalFolder = path.join(folder, "original");

  const relativeOutput = path.relative(ROOT_FOLDER, outputPath);
  const currentSignature = getSignature(filePath);

  if (optimizedMap[relativeOutput] === currentSignature && fs.existsSync(outputPath)) {
    console.log(`⏭ Already optimized: ${outputPath}`);
    return;
  }

  try {
    let image = sharp(filePath);

    if (isDirectIndexImage(filePath)) {
      image = image.resize({
        width: INDEX_MAX_WIDTH,
        withoutEnlargement: true,
      });

      console.log(`✅ Index image optimized, original ratio kept: ${outputPath}`);
    } else if (getTopFolder(filePath) === "designs") {
      image = image.resize({
        width: DESIGN_MAX_WIDTH,
        withoutEnlargement: true,
      });

      console.log(`✅ Design image optimized, original ratio kept: ${outputPath}`);
    } else {
      image = image.resize(PORTRAIT_WIDTH, PORTRAIT_HEIGHT, {
        fit: "cover",
        position: "center",
      });

      console.log(`✅ Robotics/Sketches optimized portrait 3:4: ${outputPath}`);
    }

    await image.webp({ quality: QUALITY }).toFile(tempPath);

    fs.renameSync(tempPath, outputPath);

    if (!fs.existsSync(originalFolder)) {
      fs.mkdirSync(originalFolder);
    }

    const backupPath = getUniqueBackupPath(originalFolder, path.basename(filePath));
    fs.renameSync(filePath, backupPath);

    const newSignature = getSignature(outputPath);
    optimizedMap[relativeOutput] = newSignature;
    saveTrackFile();

    console.log(`📦 Original moved to: ${backupPath}`);
    console.log(`✅ WebP placed at: ${outputPath}`);
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
  .watch(`${ROOT_FOLDER}/**/*.{jpg,jpeg,png,webp}`, {
    ignored: /(^|[/\\])original([/\\]|$)/,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
  })
  .on("add", optimizeImage)
  .on("change", optimizeImage);