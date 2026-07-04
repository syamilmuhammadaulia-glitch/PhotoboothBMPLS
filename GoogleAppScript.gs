// =================================================================
// GOOGLE APPS SCRIPT - THE DIGITAL CURATOR PHOTOBOOTH (REVISED)
// =================================================================

var PARENT_FOLDER_ID = "1oK-s77XuA7btsPdksfYnSM4DLiw9XtoE";
var SPREADSHEET_ID = "1isJDIBhfJF4cj6aUzn0pj-kbXmukA15_pMhdSEexVCs";

function doOptions(e) {
  return generateResponse({ status: "success" });
}

function doGet(e) {
  return generateResponse({
    status: "success",
    message: "Photobooth API Active!",
  });
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action;

    if (action === "create_folder_and_log") {
      return createFolderAndLog(data);
    } else if (action === "upload_file") {
      return uploadFile(data);
    } else if (action === "get_all_photos") {
      return getAllPhotos();
    } else if (action === "get_folders_with_photos") {
      return getFoldersWithPhotos();
    } else {
      return generateResponse({
        status: "error",
        message: "Action tidak dikenal",
      });
    }
  } catch (err) {
    return generateResponse({ status: "error", message: err.toString() });
  }
}

// 1. Membuat Folder Sesi & Catat ke Spreadsheet
function createFolderAndLog(data) {
  var parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var folderName = data.nama_pengunjung ? data.nama_pengunjung.trim() : "Pengunjung Anonim";
  if (folderName === "") folderName = "Pengunjung Anonim";
  var newFolder = parentFolder.createFolder(folderName);

  // Solusi Proteksi Akses Ditolak: Dibungkus try-catch agar tidak crash jika dibatasi kebijakan sekolah
  try {
    newFolder.setSharing(
      DriveApp.Access.ANYONE_WITH_LINK,
      DriveApp.Permission.VIEW,
    );
  } catch (err) {
    Logger.log("Sharing folder publik dibatasi oleh kebijakan domain akun.");
  }

  if (SPREADSHEET_ID && SPREADSHEET_ID !== "") {
    try {
      var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getActiveSheet();
      sheet.appendRow([
        new Date(),
        data.id_sesi,
        data.nama_pengunjung,
        data.no_telepon,
        data.template,
        newFolder.getUrl(),
      ]);
    } catch (e) {
      // Mengabaikan error spreadsheet agar upload foto tetap lanjut
    }
  }

  return generateResponse({
    status: "success",
    folderId: newFolder.getId(),
    folderUrl: newFolder.getUrl(),
    message: "Folder berhasil dibuat",
  });
}

// 2. Upload File (Gambar Grid & GIF)
function uploadFile(data) {
  var folder = DriveApp.getFolderById(data.folderId);
  var contentType =
    data.filename.indexOf(".gif") !== -1 ? "image/gif" : "image/jpeg";

  var byteCharacters = Utilities.base64Decode(data.image);
  var blob = Utilities.newBlob(byteCharacters, contentType, data.filename);
  var file = folder.createFile(blob);

  // Dibungkus try-catch agar aman dari pembatasan share domain sekolah
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    Logger.log("Sharing file publik dibatasi oleh kebijakan domain akun.");
  }

  return generateResponse({
    status: "success",
    fileId: file.getId(),
    fileUrl: "https://drive.google.com/uc?id=" + file.getId(),
  });
}

// 3. Mengambil Semua Foto (Live Feed)
function getAllPhotos() {
  var parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var subFolders = parentFolder.getFolders();
  var photosData = [];

  while (subFolders.hasNext()) {
    var folder = subFolders.next();
    var files = folder.getFiles();

    while (files.hasNext()) {
      var file = files.next();
      var mime = file.getMimeType();

      if (mime.indexOf("image") !== -1) {
        photosData.push({
          name: file.getName(),
          url: "https://drive.google.com/uc?id=" + file.getId(),
          timestamp: file.getDateCreated().getTime(),
        });
      }
    }
  }

  photosData.sort(function (a, b) {
    return b.timestamp - a.timestamp;
  });

  return generateResponse({ status: "success", photos: photosData });
}

// 4. Mengambil Folder Beserta Isi Foto (Cloud Drive Web)
function getFoldersWithPhotos() {
  var parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var subFolders = parentFolder.getFolders();
  var foldersData = [];

  while (subFolders.hasNext()) {
    var folder = subFolders.next();
    var files = folder.getFiles();
    var photosData = [];

    while (files.hasNext()) {
      var file = files.next();
      var mime = file.getMimeType();

      if (mime.indexOf("image") !== -1) {
        photosData.push({
          name: file.getName(),
          url: "https://drive.google.com/uc?id=" + file.getId(),
        });
      }
    }

    foldersData.push({
      name: folder.getName(),
      url: folder.getUrl(),
      createdAt: folder.getDateCreated().getTime(),
      photos: photosData,
    });
  }

  foldersData.sort(function (a, b) {
    return b.createdAt - a.createdAt;
  });

  return generateResponse({ status: "success", folders: foldersData });
}

function generateResponse(responseObject) {
  return ContentService.createTextOutput(
    JSON.stringify(responseObject),
  ).setMimeType(ContentService.MimeType.JSON);
}
