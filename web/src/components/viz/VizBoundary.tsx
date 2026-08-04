import { Component, type ReactNode } from 'react';

/**
 * The last unmet promise of #47: *"a primitive that throws degrades to the
 * caption and a static frame; the page survives."*
 *
 * Nothing caught anything before this. A primitive is the only place on a
 * concept page doing real arithmetic on authored numbers — a `params` block a
 * content PR can change, a control the reader drags — and an uncaught throw
 * inside a React island does not fail politely. It unmounts the island's whole
 * tree, which on `/c/*` means the viz vanishes and leaves a hole where the
 * figure was. The prose around it survives only because Astro islands are
 * separate roots; one page, one bad `params` value, and the concept renders
 * with a gap and no explanation.
 *
 * WHY A CLASS. Error boundaries have no hook form — `componentDidCatch` and
 * `getDerivedStateFromError` are the entire API and both are class-only. This
 * is the one class component in `/web` and it is not a style choice.
 *
 * WHY IT LIVES INSIDE EACH PRIMITIVE rather than wrapping them from
 * `VizIsland.astro`. The dispatch is in Astro so that Vite emits one chunk per
 * primitive and a concept page downloads only the one it uses — verified in
 * `dist`: `/c/attention` pulls `AttentionHeatmap`, `/c/adam` pulls
 * `UpdateSpectrum`, and neither pulls the other three. Moving the dispatch into
 * React to get a single wrapping boundary would bundle all five into one chunk
 * and put four unused primitives on every concept page, which the perf budget
 * would rightly reject. So the boundary is shared by being one implementation
 * imported five times, not by being one element rendered once.
 *
 * THE FALLBACK IS THE FRAME, NOT AN APOLOGY. The caption is the part a reader
 * can still use — it says what the picture would have shown — so it is what
 * survives. The frame stays because a missing box shifts the layout of
 * everything below it, and a reader who cannot see the figure should not also
 * lose their place.
 */

interface Props {
  /** Named so the fallback can say which primitive failed, in the same slot the caption uses. */
  primitive: string;
  caption: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export default class VizBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Console rather than swallowed: a primitive throwing is a content or code
    // bug someone has to fix, and the fallback deliberately does not look
    // broken enough for anyone to notice it from the page alone.
    console.error('viz primitive threw, falling back to its caption', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <figure className="rounded-island border border-line bg-void p-[22px]">
        <figcaption className="mb-[18px] flex flex-wrap justify-between gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-dust">
          <span>Viz primitive · {this.props.primitive}</span>
          <span>unavailable</span>
        </figcaption>
        <p className="max-w-[62ch] text-[14px] leading-[1.6] text-dust">{this.props.caption}</p>
      </figure>
    );
  }
}
