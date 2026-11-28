-- opencode joins the supported harnesses (SPEC §3.1). Rolling the image back does not remove
-- the value; an older image cannot read rows that carry it.
ALTER TYPE public."Harness" ADD VALUE 'OPENCODE';
