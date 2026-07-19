// Danh mục cố định của hồ sơ QC — bê nguyên từ apps-script/Code.gs.
// Dùng để: tạo sẵn các hạng mục khi thêm phiên QC, và lấp đầy đủ ô trống khi đọc hồ sơ.

// en      = tên ngắn, dùng cho bản PDF song ngữ (nội bộ) — cột hẹp nên phải ngắn.
// enFull  = tên đầy đủ theo mẫu docx, dùng cho bản PDF tiếng Anh (khách hàng).
// descEn  = mô tả ảnh tiếng Anh, chỉ bản khách hàng dùng.
export const DAILY_ITEMS = [
  { code: 'BEFORE_SORTING', vi: 'ĐÁNH GIÁ NGUYÊN LIỆU TRƯỚC PHÂN LOẠI', en: 'BEFORE SORTING', enFull: 'RAW MATERIAL ASSESSMENT BEFORE SORTING', descEn: 'Photo of raw materials before sorting', photoLabel: 'ảnh nguyên liệu trước phân loại / photo before sorting' },
  { code: 'AFTER_SORTING', vi: 'ĐÁNH GIÁ NGUYÊN LIỆU SAU PHÂN LOẠI', en: 'AFTER SORTING', enFull: 'RAW MATERIAL ASSESSMENT AFTER SORTING', descEn: 'Photo of raw materials after sorting', photoLabel: 'ảnh nguyên liệu sau phân loại / photo after sorting' },
  { code: 'PACKAGING_CHECK', vi: 'KIỂM TRA BAO BÌ, ĐÓNG GÓI', en: 'PACKAGING CHECK', enFull: 'PACKAGING AND PACKING INSPECTION', descEn: 'Photo of packaging / packing', photoLabel: 'ảnh bao bì / đóng gói / packaging photo' },
  { code: 'PALLET_CHECK', vi: 'KIỂM TRA XẾP PALLET', en: 'PALLET CHECK', enFull: 'PALLETIZING INSPECTION', descEn: 'Photo of palletized goods', photoLabel: 'ảnh xếp pallet / pallet photo' },
  { code: 'STORAGE_CHECK', vi: 'KIỂM TRA BẢO QUẢN', en: 'STORAGE CHECK', enFull: 'STORAGE CONDITION INSPECTION', descEn: 'Photo of storage area / warehouse', photoLabel: 'ảnh bảo quản / kho / storage photo' },
  { code: 'FINISHED_QTY_CHECK', vi: 'KIỂM TRA SỐ LƯỢNG THÀNH PHẨM', en: 'FINISHED QTY CHECK', enFull: 'FINISHED GOODS QUANTITY CHECK', descEn: 'Photo of finished goods quantity', photoLabel: 'ảnh số lượng thành phẩm / finished qty photo' },
];

export const CONTAINER_ITEMS = [
  { no: 1, code: 'PHOTO_01_RECHECK', vi: 'ẢNH 1 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 1 - QUALITY RECHECK', descVi: 'Ảnh nguyên thùng, đai/kiện của 8-10 thùng ngẫu nhiên', descEn: 'Photo of 8-10 randomly selected unopened cartons, including straps / bundles' },
  { no: 2, code: 'PHOTO_02_RECHECK', vi: 'ẢNH 2 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 2 - QUALITY RECHECK', descVi: 'Ảnh mở nắp của 3-5 thùng ngẫu nhiên', descEn: 'Photo of 3-5 randomly selected cartons with lids opened' },
  { no: 3, code: 'PHOTO_03_RECHECK', vi: 'ẢNH 3 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 3 - QUALITY RECHECK', descVi: 'Ảnh mở nắp của 3-5 thùng ngẫu nhiên', descEn: 'Photo of 3-5 randomly selected cartons with lids opened' },
  { no: 4, code: 'PHOTO_04_RECHECK', vi: 'ẢNH 4 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 4 - QUALITY RECHECK', descVi: 'Ảnh sau khi xếp tất cả hàng trong thùng ra ngoài', descEn: 'Photo after all products have been removed from the carton' },
  { no: 5, code: 'PHOTO_05_RECHECK', vi: 'ẢNH 5 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 5 - QUALITY RECHECK', descVi: 'Ảnh sau khi xếp tất cả hàng trong thùng ra ngoài', descEn: 'Photo after all products have been removed from the carton' },
  { no: 6, code: 'PHOTO_06_RECHECK', vi: 'ẢNH 6 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 6 - QUALITY RECHECK', descVi: 'Ảnh sau khi xếp tất cả hàng trong thùng ra ngoài', descEn: 'Photo after all products have been removed from the carton' },
  { no: 7, code: 'PHOTO_07_RECHECK', vi: 'ẢNH 7 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 7 - QUALITY RECHECK', descVi: 'Chụp cận 3-5 trái để đánh giá', descEn: 'Close-up photo of 3-5 fruits for quality assessment' },
  { no: 8, code: 'PHOTO_08_RECHECK', vi: 'ẢNH 8 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 8 - QUALITY RECHECK', descVi: 'Chụp cận 3-5 trái để đánh giá', descEn: 'Close-up photo of 3-5 fruits for quality assessment' },
  { no: 9, code: 'PHOTO_09_RECHECK', vi: 'ẢNH 9 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 9 - QUALITY RECHECK', descVi: 'Chụp cận 3-5 trái để đánh giá', descEn: 'Close-up photo of 3-5 fruits for quality assessment' },
  { no: 10, code: 'PHOTO_10_RECHECK', vi: 'ẢNH 10 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 10 - QUALITY RECHECK', descVi: 'Chụp cận 3-5 trái để đánh giá', descEn: 'Close-up photo of 3-5 fruits for quality assessment' },
  { no: 11, code: 'PHOTO_11_RECHECK', vi: 'ẢNH 11 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 11 - QUALITY RECHECK', descVi: 'Chụp cận 3-5 trái để đánh giá', descEn: 'Close-up photo of 3-5 fruits for quality assessment' },
  { no: 12, code: 'PHOTO_12_RECHECK', vi: 'ẢNH 12 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 12 - QUALITY RECHECK', descVi: 'Chụp cận 3-5 trái để đánh giá', descEn: 'Close-up photo of 3-5 fruits for quality assessment' },
  { no: 13, code: 'CORE_TEMPERATURE', vi: 'ẢNH 13 - ĐO NHIỆT ĐỘ TRONG TRÁI', en: 'PHOTO 13 - CORE TEMPERATURE', enFull: 'PHOTO 13 - FRUIT CORE TEMPERATURE', descVi: 'Ảnh cắm nhiệt kế vào sâu lõi quả, chờ nhiệt kế đứng im ở kết quả cuối cùng rồi chụp', descEn: 'Insert the thermometer deep into the fruit core, wait until the reading stabilizes, then take a photo' },
  { no: 14, code: 'LABEL_LOT_CODE', vi: 'ẢNH 14 - TEM NHÃN / MÃ LÔ', en: 'PHOTO 14 - LABEL/LOT CODE', descVi: 'Chụp tem nhãn được dán trên bao bì', descEn: 'Take a photo of the label affixed to the packaging' },
  { no: 15, code: 'CONTAINER_LOADING', vi: 'ẢNH 15 - XẾP CONTAINER', en: 'PHOTO 15 - CONTAINER LOADING', descVi: 'Chụp sau khi xếp đầy container', descEn: 'Take a photo after the container has been fully loaded' },
  { no: 16, code: 'PRESERVATIVE', vi: 'ẢNH 16 - THUỐC BẢO QUẢN', en: 'PHOTO 16 - PRESERVATIVE', enFull: 'PHOTO 16 - PRESERVATIVE / POST-HARVEST TREATMENT', descVi: 'Chụp cận thuốc bảo quản hoặc tình trạng bảo quản', descEn: 'Take a clear photo of the preservative or post-harvest treatment used, including the product name and dosage where applicable' },
  { no: 17, code: 'LOGGER_PHOTO', vi: 'ẢNH 17 - ẢNH LOGGER', en: 'PHOTO 17 - LOGGER PHOTO', enFull: 'PHOTO 17 - DATA LOGGER', descVi: 'Chụp logger', descEn: 'Take a clear photo of the data logger and its identification number before closing the container' },
  { no: 18, code: 'DOOR_CLOSING', vi: 'ẢNH 18 - ĐÓNG CỬA', en: 'PHOTO 18 - DOOR CLOSING', enFull: 'PHOTO 18 - CONTAINER DOOR CLOSING', descVi: 'Chụp quá trình đóng cửa container', descEn: 'Take a photo after the container doors have been fully closed' },
  { no: 19, code: 'SEALING', vi: 'ẢNH 19 - BẤM SEAL', en: 'PHOTO 19 - SEALING', enFull: 'PHOTO 19 - SEAL LOCKING', descVi: 'Chụp seal đã bấm', descEn: 'Take a photo of the secured seal' },
  { no: 20, code: 'SEAL_NUMBER', vi: 'ẢNH 20 - SỐ SEAL', en: 'PHOTO 20 - SEAL NUMBER', descVi: 'Chụp cận số seal', descEn: 'Take a close-up photo of the seal number' },
  { no: 21, code: 'DEPARTURE_TEMPERATURE', vi: 'ẢNH 21 - NHIỆT ĐỘ RỜI KHO', en: 'PHOTO 21 - DEPARTURE TEMPERATURE', enFull: 'PHOTO 21 - TEMPERATURE AT WAREHOUSE DEPARTURE', descVi: 'Chụp nhiệt độ khi container rời kho', descEn: 'Take a photo of the temperature when the container leaves the warehouse' },
];
