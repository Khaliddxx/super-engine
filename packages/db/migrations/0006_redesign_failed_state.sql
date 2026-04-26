-- Dedicated state for "enriched but no preview" so prospects aren't lost in generic REJECTED.
UPDATE prospects
SET state = 'REDESIGN_FAILED'
WHERE state = 'REJECTED'
  AND (rejection_reason LIKE 'redesign_generation_failed:%' OR rejection_reason LIKE 'redesign_exception:%');
