import { prospects, type DbClient, type Prospect } from "@super-engine/db";
import { domainSearch, pickBestEmail, pickLinkedInUrl } from "../integrations/hunter.js";
import { scrape, scrapeSite, extractSiteInfo, extractRichSiteInfo } from "../integrations/firecrawl.js";
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
    // Multi-page site scrape (sitemap + high-signal subpages). Falls back to
    // homepage-only if sitemap/crawl fails.
    const siteResults = await scrapeSite(prospect.website, { maxPages: 5 }).catch((e) => {
      logger.warn({ err: String(e), prospectId: prospect.id }, "scrapeSite failed, falling back to homepage");
      return [];
    });

    let services: string[] | null = null;
    let heroCopy: string | null = null;
    let aboutCopy: string | null = null;
    let testimonials: string[] | null = null;
    let scrapedPagesMeta: Array<{ url: string; title: string; length: number }> | null = null;
    let detectedYear: number | null = null;
    let totalLength = 0;

    if (siteResults.length > 0) {
      const rich = extractRichSiteInfo(siteResults);
      services = rich.services.length ? rich.services : null;
      heroCopy = rich.heroCopy || null;
      aboutCopy = rich.aboutCopy || null;
      testimonials = rich.testimonials.length ? rich.testimonials : null;
      detectedYear = rich.copyrightYear;
      totalLength = rich.totalTextLength;
      scrapedPagesMeta = rich.pagesScraped;
      logger.info(
        { prospectId: prospect.id, pages: rich.pagesScraped.length, chars: totalLength },
        "enrich: rich site info",
      );
    } else {
      // Fallback to single homepage scrape
      const scrapeRes = await scrape(prospect.website).catch((e) => {
        logger.warn({ err: String(e), prospectId: prospect.id }, "firecrawl homepage failed, continuing partial");
        return null;
      });
      if (scrapeRes) {
        const info = extractSiteInfo(scrapeRes);
        services = info.services.length ? info.services : null;
        heroCopy = info.heroCopy || null;
        detectedYear = info.copyrightYear;
        totalLength = info.textLength;
      }
    }

    if (totalLength > 0 && totalLength < 500) {
      throw new RejectProspectError("domain_parked", `Site has <500 chars of text across all pages (${totalLength})`);
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
        scrapedAboutCopy: aboutCopy,
        scrapedTestimonials: testimonials,
        scrapedPages: scrapedPagesMeta as any,
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
