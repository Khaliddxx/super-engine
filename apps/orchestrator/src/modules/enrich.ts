import { prospects, type DbClient, type Prospect } from "@super-engine/db";
import { domainSearch, pickBestEmail, pickLinkedInUrl } from "../integrations/hunter.js";
import { scrape, extractSiteInfo } from "../integrations/firecrawl.js";
import { RejectProspectError } from "../lib/errors.js";
import { transition } from "./transitions.js";
import { logger } from "../lib/logger.js";

export async function enrichProspect(db: DbClient, prospect: Prospect): Promise<void> {
  if (!prospect.website) {
    await transition({
      db,
      prospectId: prospect.id,
      from: prospect.state as any,
      to: "REJECTED",
      reason: "no_website",
      patch: { rejectionReason: "no_website" },
    });
    return;
  }

  try {
    // Firecrawl scrape first (so we can detect domain-parked/site-blocked early)
    const scrapeRes = await scrape(prospect.website).catch((e) => {
      logger.warn({ err: String(e), prospectId: prospect.id }, "firecrawl failed, continuing with partial enrich");
      return null;
    });

    let services: string[] | null = null;
    let heroCopy: string | null = null;
    let detectedYear: number | null = null;
    let textLength = 0;

    if (scrapeRes) {
      const info = extractSiteInfo(scrapeRes);
      services = info.services.length ? info.services : null;
      heroCopy = info.heroCopy || null;
      detectedYear = info.copyrightYear;
      textLength = info.textLength;

      if (textLength < 500) {
        throw new RejectProspectError("domain_parked", `Site has <500 chars of text (${textLength})`);
      }
    }

    // Hunter email enrichment
    const hunter = await domainSearch(prospect.website).catch((e) => {
      logger.warn({ err: String(e), prospectId: prospect.id }, "hunter failed, continuing without email");
      return null;
    });
    const best = hunter ? pickBestEmail(hunter.emails) : null;
    const linkedinUrl = hunter ? pickLinkedInUrl(hunter, best) : null;

    if (!best && !linkedinUrl) {
      throw new RejectProspectError("no_contact", "No email and no LinkedIn URL found");
    }

    await transition({
      db,
      prospectId: prospect.id,
      from: prospect.state as any,
      to: "ENRICHED",
      reason: "enriched",
      patch: {
        email: best?.value ?? prospect.email,
        linkedinUrl: linkedinUrl ?? prospect.linkedinUrl,
        scrapedServices: services,
        scrapedCopy: heroCopy,
        detectedYear,
      },
    });
  } catch (err) {
    if (err instanceof RejectProspectError) {
      await transition({
        db,
        prospectId: prospect.id,
        from: prospect.state as any,
        to: "REJECTED",
        reason: err.reason,
        patch: { rejectionReason: err.reason },
      });
      return;
    }
    throw err;
  }
}
