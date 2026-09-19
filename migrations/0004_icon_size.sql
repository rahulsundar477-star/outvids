-- Icon quality: the pixel size of the stored icon, read from its own header by server/enrich.ts.
-- 0 x 0 means SVG (vector, so any size). NULL means the row predates this column or has no icon.
ALTER TABLE listing_meta ADD COLUMN icon_w INTEGER;
ALTER TABLE listing_meta ADD COLUMN icon_h INTEGER;
