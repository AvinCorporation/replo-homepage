// 요금 계산. 서버(실제 청구)와 화면(결제 예정 안내)이 같은 함수를 씁니다.
// 날짜는 모두 Asia/Seoul 기준의 "YYYY-MM-DD" 문자열로 다룹니다.

export type ChargeLine = {
  label: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
};

export type FirstCharge = {
  lines: ChargeLine[];
  totalAmount: number;
  periodStart: string;
  periodEnd: string;
  nextBillingDate: string;
};

function parts(dateKey: string) {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  return { year, month, day };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function firstDayOf(year: number, month: number) {
  const shifted = month > 12 ? { year: year + Math.floor((month - 1) / 12), month: ((month - 1) % 12) + 1 } : { year, month };
  return `${shifted.year}-${pad(shifted.month)}-01`;
}

export function lastDayOf(year: number, month: number) {
  const normalizedYear = year + Math.floor((month - 1) / 12);
  const normalizedMonth = ((month - 1) % 12) + 1;
  return `${normalizedYear}-${pad(normalizedMonth)}-${pad(daysInMonth(normalizedYear, normalizedMonth))}`;
}

export function addMonths(dateKey: string, count: number) {
  const { year, month, day } = parts(dateKey);
  const total = year * 12 + (month - 1) + count;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  const cappedDay = Math.min(day, daysInMonth(nextYear, nextMonth));
  return `${nextYear}-${pad(nextMonth)}-${pad(cappedDay)}`;
}

// 남은 일수는 오늘을 포함합니다. 9/28이면 28·29·30 → 3일.
export function remainingDays(dateKey: string) {
  const { year, month, day } = parts(dateKey);
  return daysInMonth(year, month) - day + 1;
}

export function proratedAmount(monthlyFee: number, dateKey: string) {
  const { year, month } = parts(dateKey);
  const total = daysInMonth(year, month);
  return Math.round((monthlyFee * remainingDays(dateKey)) / total);
}

function monthLabel(month: number) {
  return `${month}월`;
}

/**
 * 무료에서 유료 플랜으로 처음 넘어갈 때의 청구 내역.
 *
 * 정기 결제일을 매월 1일로 맞추기 위해, 이번 달 잔여기간 요금과 다음 달 이용료를
 * 한 번에 청구하고 다다음 달 1일을 다음 결제일로 잡습니다. 며칠 뒤에 카드가 다시
 * 긁히는 상황을 만들지 않기 위한 방식입니다.
 *
 * 1일에 시작하는 경우는 잔여기간이 곧 한 달이므로 묶지 않고 한 달치만 청구합니다.
 */
export function planFirstCharge(monthlyFee: number, today: string): FirstCharge {
  const { year, month, day } = parts(today);

  if (day === 1) {
    const periodEnd = lastDayOf(year, month);
    return {
      lines: [
        {
          label: `${monthLabel(month)} 이용료`,
          periodStart: today,
          periodEnd,
          amount: monthlyFee,
        },
      ],
      totalAmount: monthlyFee,
      periodStart: today,
      periodEnd,
      nextBillingDate: firstDayOf(year, month + 1),
    };
  }

  const thisMonthEnd = lastDayOf(year, month);
  const nextMonthStart = firstDayOf(year, month + 1);
  const nextMonthEnd = lastDayOf(year, month + 1);
  const remainder = proratedAmount(monthlyFee, today);
  const nextMonthNumber = month === 12 ? 1 : month + 1;

  return {
    lines: [
      {
        label: `${monthLabel(month)} 잔여기간 (${remainingDays(today)}일)`,
        periodStart: today,
        periodEnd: thisMonthEnd,
        amount: remainder,
      },
      {
        label: `${monthLabel(nextMonthNumber)} 이용료`,
        periodStart: nextMonthStart,
        periodEnd: nextMonthEnd,
        amount: monthlyFee,
      },
    ],
    totalAmount: remainder + monthlyFee,
    periodStart: today,
    periodEnd: nextMonthEnd,
    nextBillingDate: firstDayOf(year, month + 2),
  };
}

// 정기 결제(매월 1일)로 청구할 한 달치 기간.
export function monthlyCyclePeriod(billingDate: string) {
  const { year, month } = parts(billingDate);
  return {
    periodStart: firstDayOf(year, month),
    periodEnd: lastDayOf(year, month),
    nextBillingDate: firstDayOf(year, month + 1),
  };
}

// 토스 orderId. 같은 워크스페이스·기간·플랜이면 항상 같은 값이라 중복 청구를 막습니다.
export function buildOrderId(workspaceId: string, planId: string, periodStart: string) {
  return `replo_${workspaceId.replace(/-/g, "").slice(0, 12)}_${planId}_${periodStart.replace(/-/g, "")}`;
}
