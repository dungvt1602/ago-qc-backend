// Danh mục cố định của hồ sơ QC — bê nguyên từ apps-script/Code.gs.
// Dùng để: tạo sẵn các hạng mục khi thêm phiên QC, và lấp đầy đủ ô trống khi đọc hồ sơ.

export const DAILY_ITEMS = [
  { code: 'BEFORE_SORTING', vi: 'ĐÁNH GIÁ NGUYÊN LIỆU TRƯỚC PHÂN LOẠI', en: 'BEFORE SORTING', photoLabel: 'ảnh nguyên liệu trước phân loại / photo before sorting' },
  { code: 'AFTER_SORTING', vi: 'ĐÁNH GIÁ NGUYÊN LIỆU SAU PHÂN LOẠI', en: 'AFTER SORTING', photoLabel: 'ảnh nguyên liệu sau phân loại / photo after sorting' },
  { code: 'PACKAGING_CHECK', vi: 'KIỂM TRA BAO BÌ, ĐÓNG GÓI', en: 'PACKAGING CHECK', photoLabel: 'ảnh bao bì / đóng gói / packaging photo' },
  { code: 'PALLET_CHECK', vi: 'KIỂM TRA XẾP PALLET', en: 'PALLET CHECK', photoLabel: 'ảnh xếp pallet / pallet photo' },
  { code: 'STORAGE_CHECK', vi: 'KIỂM TRA BẢO QUẢN', en: 'STORAGE CHECK', photoLabel: 'ảnh bảo quản / kho / storage photo' },
  { code: 'FINISHED_QTY_CHECK', vi: 'KIỂM TRA SỐ LƯỢNG THÀNH PHẨM', en: 'FINISHED QTY CHECK', photoLabel: 'ảnh số lượng thành phẩm / finished qty photo' },
];

export const CONTAINER_ITEMS = [
  { no: 1, code: 'PHOTO_01_RECHECK', vi: 'ẢNH 1 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 1 - QUALITY RECHECK', descVi: 'Ảnh nguyên thùng, đai/kiện của 8-10 thùng ngẫu nhiên', descEn: 'Photo of 8-10 random cartons/bundles' },
  { no: 2, code: 'PHOTO_02_RECHECK', vi: 'ẢNH 2 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 2 - QUALITY RECHECK', descVi: 'Ảnh mở nắp của 3-5 thùng ngẫu nhiên', descEn: 'Open-top photo of 3-5 random cartons' },
  { no: 3, code: 'PHOTO_03_RECHECK', vi: 'ẢNH 3 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 3 - QUALITY RECHECK', descVi: 'Ảnh mở nắp của 3-5 thùng ngẫu nhiên', descEn: 'Open-top photo of 3-5 random cartons' },
  { no: 4, code: 'PHOTO_04_RECHECK', vi: 'ẢNH 4 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 4 - QUALITY RECHECK', descVi: 'Ảnh sau khi xếp tất cả hàng trong thùng ra ngoài', descEn: 'Photo after laying all carton contents out' },
  { no: 5, code: 'PHOTO_05_RECHECK', vi: 'ẢNH 5 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 5 - QUALITY RECHECK', descVi: 'Ảnh sau khi xếp tất cả hàng trong thùng ra ngoài', descEn: 'Photo after laying all carton contents out' },
  { no: 6, code: 'PHOTO_06_RECHECK', vi: 'ẢNH 6 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 6 - QUALITY RECHECK', descVi: 'Ảnh sau khi xếp tất cả hàng trong thùng ra ngoài', descEn: 'Photo after laying all carton contents out' },
  { no: 7, code: 'PHOTO_07_RECHECK', vi: 'ẢNH 7 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 7 - QUALITY RECHECK', descVi: 'Chụp cận 3-5 trái để đánh giá', descEn: 'Close-up of 3-5 fruits for assessment' },
  { no: 8, code: 'PHOTO_08_RECHECK', vi: 'ẢNH 8 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 8 - QUALITY RECHECK', descVi: 'Chụp cận 3-5 trái để đánh giá', descEn: 'Close-up of 3-5 fruits for assessment' },
  { no: 9, code: 'PHOTO_09_RECHECK', vi: 'ẢNH 9 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 9 - QUALITY RECHECK', descVi: 'Chụp cận 3-5 trái để đánh giá', descEn: 'Close-up of 3-5 fruits for assessment' },
  { no: 10, code: 'PHOTO_10_RECHECK', vi: 'ẢNH 10 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 10 - QUALITY RECHECK', descVi: 'Chụp cận 3-5 trái để đánh giá', descEn: 'Close-up of 3-5 fruits for assessment' },
  { no: 11, code: 'PHOTO_11_RECHECK', vi: 'ẢNH 11 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 11 - QUALITY RECHECK', descVi: 'Chụp cận 3-5 trái để đánh giá', descEn: 'Close-up of 3-5 fruits for assessment' },
  { no: 12, code: 'PHOTO_12_RECHECK', vi: 'ẢNH 12 - RECHECK CHẤT LƯỢNG', en: 'PHOTO 12 - QUALITY RECHECK', descVi: 'Chụp cận 3-5 trái để đánh giá', descEn: 'Close-up of 3-5 fruits for assessment' },
  { no: 13, code: 'CORE_TEMPERATURE', vi: 'ẢNH 13 - ĐO NHIỆT ĐỘ TRONG TRÁI', en: 'PHOTO 13 - CORE TEMPERATURE', descVi: 'Ảnh cắm nhiệt kế vào sâu lõi quả, chờ nhiệt kế đứng im ở kết quả cuối cùng rồi chụp', descEn: 'Insert thermometer into fruit core and photograph final stable reading' },
  { no: 14, code: 'LABEL_LOT_CODE', vi: 'ẢNH 14 - TEM NHÃN / MÃ LÔ', en: 'PHOTO 14 - LABEL/LOT CODE', descVi: 'Chụp tem nhãn được dán trên bao bì', descEn: 'Photo of labels attached to packaging' },
  { no: 15, code: 'CONTAINER_LOADING', vi: 'ẢNH 15 - XẾP CONTAINER', en: 'PHOTO 15 - CONTAINER LOADING', descVi: 'Chụp sau khi xếp đầy container', descEn: 'Photo after container is fully loaded' },
  { no: 16, code: 'PRESERVATIVE', vi: 'ẢNH 16 - THUỐC BẢO QUẢN', en: 'PHOTO 16 - PRESERVATIVE', descVi: 'Chụp cận thuốc bảo quản hoặc tình trạng bảo quản', descEn: 'Photo of preservative or preservation condition' },
  { no: 17, code: 'LOGGER_PHOTO', vi: 'ẢNH 17 - ẢNH LOGGER', en: 'PHOTO 17 - LOGGER PHOTO', descVi: 'Chụp logger', descEn: 'Logger photo' },
  { no: 18, code: 'DOOR_CLOSING', vi: 'ẢNH 18 - ĐÓNG CỬA', en: 'PHOTO 18 - DOOR CLOSING', descVi: 'Chụp quá trình đóng cửa container', descEn: 'Photo of door closing' },
  { no: 19, code: 'SEALING', vi: 'ẢNH 19 - BẤM SEAL', en: 'PHOTO 19 - SEALING', descVi: 'Chụp seal đã bấm', descEn: 'Photo of applied seal' },
  { no: 20, code: 'SEAL_NUMBER', vi: 'ẢNH 20 - SỐ SEAL', en: 'PHOTO 20 - SEAL NUMBER', descVi: 'Chụp cận số seal', descEn: 'Close-up of seal number' },
  { no: 21, code: 'DEPARTURE_TEMPERATURE', vi: 'ẢNH 21 - NHIỆT ĐỘ RỜI KHO', en: 'PHOTO 21 - DEPARTURE TEMPERATURE', descVi: 'Chụp nhiệt độ khi container rời kho', descEn: 'Photo of temperature when container leaves warehouse' },
];
