/**
 * 차트 막대(해당 시간 단위의 계획/실적) 용어.
 * "증분(increment)" 대신 시간 단위에 맞춘 목표 용어를 쓴다.
 */
export type ChartBucketUnit = "day" | "week" | "month" | (string & {});

export function bucketTargetTerm(bucket?: ChartBucketUnit): string {
  switch (bucket) {
    case "week":
      return "금주목표";
    case "month":
      return "당월목표";
    case "day":
      return "당일목표";
    default:
      return "기간목표";
  }
}
