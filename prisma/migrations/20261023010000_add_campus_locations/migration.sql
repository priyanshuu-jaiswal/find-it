-- CreateTable
CREATE TABLE IF NOT EXISTS "campus_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campus_locations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campus_locations_organization_id_fkey'
  ) THEN
    ALTER TABLE "campus_locations" ADD CONSTRAINT "campus_locations_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "campus_locations_organization_id_is_active_sort_order_idx"
  ON "campus_locations"("organization_id", "is_active", "sort_order");

-- Seed default locations for existing organizations if none exist
INSERT INTO "campus_locations" ("organization_id", "name", "area", "sort_order")
SELECT o.id, loc.name, loc.area, loc.sort_order
FROM "organizations" o
CROSS JOIN (
  VALUES
    ('Central Library & Reading Hall', 'Central', 1),
    ('Food Court / Student Cafeteria', 'Food', 2),
    ('Basic Science Block (BS-302 / Labs)', 'Basic', 3),
    ('Main Block (Aero / Mech / Physics)', 'Main', 4),
    ('Civil & Electrical Block', 'Civil', 5),
    ('Sports Complex & Cricket Ground', 'Sports', 6),
    ('Kaveri / Main Auditorium', 'Kaveri', 7),
    ('Placement & Admin Block', 'Placement', 8),
    ('Hostel Block / Campus Gate', 'Hostel', 9)
) AS loc(name, area, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM "campus_locations" cl WHERE cl.organization_id = o.id
);
