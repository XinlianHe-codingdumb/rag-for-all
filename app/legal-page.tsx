import Link from "next/link";

type LegalSection = { title: string; paragraphs?: string[]; bullets?: string[] };

export function LegalPage({ eyebrow, title, introduction, sections }: { eyebrow: string; title: string; introduction: string; sections: LegalSection[] }) {
  return <main className="legal-shell">
    <header className="legal-header"><Link href="/">RAG FOR ALL</Link><nav aria-label="Legal pages"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav></header>
    <article className="legal-document">
      <div className="legal-intro"><p>{eyebrow}</p><h1>{title}</h1><strong>{introduction}</strong><small>Last updated: August 16, 2026</small></div>
      <div className="legal-sections">
        {sections.map((section) => <section key={section.title}><h2>{section.title}</h2>{section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>}</section>)}
      </div>
      <footer><Link href="/">← Back to the RAG workspace</Link><span>Public beta · RAG FOR ALL</span></footer>
    </article>
  </main>;
}
