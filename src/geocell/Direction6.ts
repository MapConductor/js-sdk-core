// 方向の種類を列挙
export enum Direction6 {
  Right = "Right",
  RightUp = "RightUp",
  LeftUp = "LeftUp",
  Left = "Left",
  LeftDown = "LeftDown",
  RightDown = "RightDown",
}

// 各方向の座標変化量を定義
export const Direction6Delta: Record<Direction6, { deltaQ: number; deltaR: number }> = {
  [Direction6.Right]: { deltaQ: 1, deltaR: 0 },
  [Direction6.RightUp]: { deltaQ: 1, deltaR: -1 },
  [Direction6.LeftUp]: { deltaQ: 0, deltaR: -1 },
  [Direction6.Left]: { deltaQ: -1, deltaR: 0 },
  [Direction6.LeftDown]: { deltaQ: -1, deltaR: 1 },
  [Direction6.RightDown]: { deltaQ: 0, deltaR: 1 },
};
