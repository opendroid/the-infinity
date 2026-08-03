import { useEffect, useRef } from 'react';

interface Props {
  /** What to announce. Empty means the region is present and has nothing to say. */
  message: string;
  /**
   * `role="alert"` rather than `role="status"` — assertive, interrupting.
   * For a failure the reader needs to know about before doing anything else.
   */
  assertive?: boolean;
  /** Applied only when there is a message; an empty region is always sr-only. */
  className?: string;
  /**
   * Move focus here when the message arrives. Set it when the control the
   * reader was standing on is replaced by this message — see the note below.
   */
  takeFocus?: boolean;
}

/**
 * A live region that exists before it has anything to say.
 *
 * `role="status"` and `role="alert"` announce a CHANGE to a region already in
 * the accessibility tree. A region created together with its text is a new
 * subtree, not a change, and screen readers announce it unreliably or not at
 * all — which is how every confirmation on this site was built until #137, and
 * why a reader could flag an error and hear nothing back.
 *
 * So this renders always. When there is nothing to say it is `sr-only` and
 * empty, occupying no space and reading as nothing; when a message arrives only
 * its text changes, which is the mutation a reader is listening for. Because it
 * is the same element in the same position across every state, React keeps the
 * same DOM node — which is the whole mechanism, and what
 * `LiveRegion.test.tsx` asserts on identity rather than on markup.
 *
 * ON FOCUS. When the control that had focus is unmounted — the "Volunteer to
 * review" button becomes a thank-you — the browser drops focus to `<body>`, so
 * a keyboard user is silently returned to the top of the document. `takeFocus`
 * moves focus to the message instead. That risks a reader announcing the text
 * twice, once for the live region and once for the focus. Hearing it twice is
 * a smaller harm than hearing it not at all and losing your place as well, so
 * that is the trade this makes deliberately.
 */
export default function LiveRegion({ message, assertive = false, className, takeFocus }: Props) {
  const ref = useRef<HTMLParagraphElement>(null);
  const previous = useRef('');

  useEffect(() => {
    const arrived = message !== '' && previous.current === '';
    previous.current = message;
    if (arrived && takeFocus) ref.current?.focus();
  }, [message, takeFocus]);

  return (
    <p
      ref={ref}
      role={assertive ? 'alert' : 'status'}
      // -1 only while there is something to read: a permanently focusable empty
      // paragraph would be a stop in the sequential order that says nothing.
      tabIndex={takeFocus && message !== '' ? -1 : undefined}
      className={message !== '' && className ? className : 'sr-only'}
    >
      {message}
    </p>
  );
}
