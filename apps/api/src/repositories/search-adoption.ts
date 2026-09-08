/** One aggregate definition for member Home and administrative Usage metrics. */
const searchAdoptionAggregates = {
  sessions: "count(*)",
  agentcommons_search_sessions: "countIf(t.agentcommons_search_calls>0)",
  agentcommons_search_rate:
    "toFloat64(countIf(t.agentcommons_search_calls>0))/nullIf(count(*),0)",
  agentcommons_search_calls: "coalesce(sum(t.agentcommons_search_calls),0)",
  repeat_agentcommons_search_calls:
    "coalesce(sum(t.repeat_agentcommons_search_calls),0)",
  subsequent_other_search_calls:
    "coalesce(sum(t.subsequent_other_search_calls),0)",
} as const;

export const searchAdoptionSelect = Object.entries(searchAdoptionAggregates)
  .map(([column, expression]) => `toFloat64(${expression}) AS ${column}`)
  .join(",");
