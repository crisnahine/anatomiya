/**
 * What the two arms' numbers say, in the file rather than in the reader's head.
 *
 * The first A/B ever run scored 10 of 10 in both arms and was written up as a
 * null result about the map. It was a null result about the task: the claim it
 * picked sat at 140 of 145 and the model would have had to write the failing
 * form three times in a hundred for the arms to differ at all. A result file
 * that leaves the two apart to the reader invites that mistake a second time,
 * so it is stated here and the harness cannot forget to.
 */
export function readingFor({ a, b }, headroom) {
  const ratio = (x) => (x.candidates ? (x.conforming / x.candidates).toFixed(3) : null);
  const ra = ratio(a);
  const rb = ratio(b);

  if (ra === null && rb === null) {
    return [
      "**Neither arm wrote a site this claim counts.** The trials wrote something, or wrote nothing,",
      "but none of it was the construct this dimension measures, so the run says nothing about the map",
      "either way. Pick a task whose obvious solution lands in the claim's own construct.",
    ].join("\n");
  }

  if (ra === null || rb === null) {
    const which = ra === null ? "with the map" : "without it";
    return [
      "**Only one arm wrote a site this claim counts.** The run",
      `${which} produced nothing the dimension measures, so there are not two numbers to compare.`,
      "Read it as a run that did not happen rather than as a score of zero.",
    ].join(" ");
  }

  if (ra === rb && Number(ra) === 1) {
    return [
      "**Both arms wrote conforming code every time.** That is a null result about this task, not",
      `about the map: the area has headroom ${headroom.toFixed(3)}, so the failing form exists in the`,
      "repository, and the model simply did not reach for it here with the map or without. A task that",
      "cannot separate the arms cannot measure them. Pick one where the violating form is the shorter",
      "thing to write.",
    ].join("\n");
  }

  if (ra === rb) {
    return [
      `**Both arms scored ${ra}.** The map did not move this claim on this task. That is a result`,
      "about the two arms rather than about the run, and it is only as strong as the trial counts",
      "above: a handful of files either side is a handful of files.",
    ].join(" ");
  }

  const [better, worse] = Number(ra) > Number(rb) ? ["with the map", "without it"] : ["without the map", "with it"];
  return [
    `**The arms differ: ${ra} against ${rb}.** The run ${better} produced the conforming form more`,
    `often than the run ${worse}. Read it against the trial counts above rather than on its own: a`,
    "handful of files is a handful of files, and the arms have to have written comparable numbers of",
    "them before the ratio carries anything.",
  ].join("\n");
}
