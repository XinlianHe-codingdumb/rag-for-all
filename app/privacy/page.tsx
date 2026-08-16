import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy — RAG FOR ALL",
  description: "How RAG FOR ALL handles documents, anonymous product analytics, model requests, retention, and deletion.",
  openGraph: { title: "Privacy — RAG FOR ALL", description: "How the public beta handles documents, analytics, and model requests.", images: [] },
  twitter: { title: "Privacy — RAG FOR ALL", description: "How the public beta handles documents, analytics, and model requests.", images: [] },
};

export default function PrivacyPage() {
  return <LegalPage
    eyebrow="PLAIN-ENGLISH PRIVACY NOTICE"
    title="Your document is here to teach the pipeline—not train a mystery machine."
    introduction="RAG FOR ALL is a public educational beta. You can use it without an account. This notice explains what we collect, where it goes, and how you can remove it."
    sections={[
      { title: "What we handle", bullets: ["A random first-party session ID stored in an HttpOnly cookie for seven days. It separates your temporary workspace from other visitors without requiring a name or email.", "Documents you choose to upload, their parsed text, and basic metadata such as file name, size, type, and page count.", "Questions, pipeline settings, retrieved passages, and experiment results needed to run and explain your RAG workflow.", "Privacy-safe product events such as section views, pipeline-step clicks, completed uploads, and completed runs. These events use broad buckets rather than document or question content.", "Operational metadata such as request ID, route, timing, model name, token counts, file size, and error type."] },
      { title: "Where your data goes", paragraphs: ["Uploaded file bytes are stored in private object storage and document/run metadata is stored in the project database. Records are linked to the anonymous browser session on the server.", "When OpenAI-powered Embedding, Reranking, or Answer steps are used, the relevant text, question, and selected passages are sent to the configured OpenAI API. Those requests are sent with API storage disabled. Local fallback steps do not send their text to OpenAI.", "Cloud infrastructure and model providers may process data in locations outside your country. Do not use this public beta for data that has regulatory, contractual, or residency requirements."] },
      { title: "Analytics and abuse protection", paragraphs: ["Product analytics measure anonymous visits, journey choices, section interest, and funnel completion so we can learn where the product is useful or confusing. Analytics do not include filenames, document text, questions, prompts, answers, email addresses, or raw IP addresses.", "For rate limiting, the service converts an IP address into a short one-way hash using a secret and the current date. The raw address is not stored by the application, and the hash changes each day."] },
      { title: "What our logs do not contain", paragraphs: ["Operational logs are designed not to contain document bodies, complete prompts, email addresses, raw IP addresses, or API keys. They use opaque hashes so failures and usage can be investigated without putting the document into a log line."] },
      { title: "Retention and deletion", paragraphs: ["Saved documents, parsed text, and linked experiment history are scheduled for automatic deletion seven days after upload. Cleanup runs as part of service maintenance, so removal may not happen at the exact minute the period ends.", "You can delete the current document immediately from the Document step. The same action removes its stored original, parsed copy, and linked run history. Temporary browser-only sample content is not uploaded.", "Anonymous product analytics are retained for up to 90 days, then deleted. Aggregate insights may be kept without a session identifier."] },
      { title: "Your choices", bullets: ["Use non-sensitive test documents during the public beta.", "Delete a document whenever you no longer need it.", "Clear site data in your browser to remove the anonymous session cookie.", "Stop using the service at any time."] },
      { title: "Changes", paragraphs: ["This beta will evolve. If data handling changes materially, this notice will be updated before the new behavior is used."] },
    ]}
  />;
}
