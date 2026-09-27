// Bidi isolation for user-supplied text (member names, group names, plan titles) inside translated sentences.
// Without it an Arabic sentence like "بانتظار أن يسأل {name} Grok." renders a Latin name and "Grok" as one
// left-to-right run ("Lucía Grok"), and punctuation/digits in a name ("Jordan B.", "Sam 2") jump to the wrong side.
// <bdi> (and FSI…PDI in plain strings) keeps each name its own direction without disturbing the sentence around it.
import { Fragment, type ReactNode } from "react";

/** Isolated name for `tNodes(key, { name: iso(member.display_name) })`. */
export const iso = (text: string): ReactNode => <bdi>{text}</bdi>;

/** Several isolated names joined by the locale's list separator (`common.listSep`). */
export const isoList = (names: string[], sep: string): ReactNode =>
  names.map((n, i) => (
    <Fragment key={i}>
      {i > 0 && sep}
      <bdi>{n}</bdi>
    </Fragment>
  ));

/** Plain-string contexts (error messages kept in string state): U+2068 FIRST STRONG ISOLATE … U+2069 POP DIRECTIONAL ISOLATE. */
export const isoText = (text: string): string => `\u2068${text}\u2069`;
