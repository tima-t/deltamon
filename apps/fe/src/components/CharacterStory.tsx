import Image from "next/image";

export function CharacterStory() {
  return (
    <section id="meet-tippet" className="counter-lore" aria-labelledby="counter-lore-title">
      <div className="counter-lore-inner">
        <div className="counter-lore-meta">
          <p className="counter-section-index">FIELD NOTE 001 / THE CHARACTER</p>
          <span>From Tippet&apos;s notebook ✳</span>
        </div>

        <div className="counter-lore-grid">
          <div className="counter-lore-art" aria-hidden="true">
            <span className="counter-lore-asterisk">✳</span>
            <div className="counter-lore-art-orbit" />
            <Image
              src="/art/counterweight-mascot.png"
              alt=""
              width={1536}
              height={1024}
              className="counter-lore-mascot"
            />
            <div className="counter-lore-note">
              <span>POCKET NOTE / 01</span>
              <strong>Always ask what&apos;s on the other side.</strong>
              <small>Then write down when you checked.</small>
            </div>
          </div>

          <div className="counter-lore-copy">
            <h2 id="counter-lore-title">
              Meet <em>Tippet.</em>
            </h2>
            <p className="counter-lore-quote">“Wait. What&apos;s on the other side?”</p>
            <p className="counter-lore-story">
              In our little story, Tippet appeared beside a chart that only showed one side of a
              position. It went looking for the other side, then came back with a second question:
              <strong> when was it measured?</strong>
            </p>
            <p className="counter-lore-story">
              That is Tippet&apos;s whole personality: curious, a little stubborn, and delighted by
              a good label. It even labels its lunch. It would rather admit “I don&apos;t know yet”
              than draw a perfectly level line from old numbers.
            </p>
            <div className="counter-lore-traits" aria-label="Tippet's character traits">
              <div>
                <span>FAVORITE QUESTION</span>
                <strong>What&apos;s opposite it?</strong>
              </div>
              <div>
                <span>POCKET CONTENTS</span>
                <strong>Notes, dates, crumbs.</strong>
              </div>
              <div>
                <span>LEAST FAVORITE WORD</span>
                <strong>Always.</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="counter-lore-chapters">
          <p>
            <span>THE DELTAMON FIELD BOOK</span>
            <strong>Chapter 01 follows MON and an offsetting short.</strong> If more strategies join
            the book, each will have its own exposures, measurements, and risks.
          </p>
        </div>
      </div>
    </section>
  );
}
