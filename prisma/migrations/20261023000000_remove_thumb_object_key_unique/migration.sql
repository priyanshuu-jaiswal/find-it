-- DropIndex / DropConstraint
ALTER TABLE "report_images" DROP CONSTRAINT IF EXISTS "report_images_thumb_object_key_key";
DROP INDEX IF EXISTS "report_images_thumb_object_key_key";
