import { HexCellWithDistance } from ".";
import { Offset } from "../types";
import { HexCell } from "./HexCell";

export interface KDTreeStats {
    nodeCount: number;
    maxDepth: number;
    isEmpty: boolean;
}

/**
 * Max Heap for k-nearest neighbor search
 * Maintains the k closest points by keeping the farthest of the k in the heap root
 */
class MaxHeap<T> {
    private heap: Array<[priority: number, value: T]> = [];

    get size(): number {
        return this.heap.length;
    }

    peek(): [number, T] | null {
        return this.heap.length > 0 ? this.heap[0] : null;
    }

    push(priority: number, value: T): void {
        this.heap.push([priority, value]);
        this.bubbleUp(this.heap.length - 1);
    }

    pop(): [number, T] | null {
        if (this.heap.length === 0) return null;
        if (this.heap.length === 1) return this.heap.pop()!;

        const root = this.heap[0];
        this.heap[0] = this.heap.pop()!;
        this.bubbleDown(0);
        return root;
    }

    private bubbleUp(index: number): void {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (this.heap[index][0] <= this.heap[parentIndex][0]) break;

            // Swap
            [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
            index = parentIndex;
        }
    }

    private bubbleDown(index: number): void {
        while (true) {
            const leftChild = 2 * index + 1;
            const rightChild = 2 * index + 2;
            let largest = index;

            if (leftChild < this.heap.length && this.heap[leftChild][0] > this.heap[largest][0]) {
                largest = leftChild;
            }
            if (rightChild < this.heap.length && this.heap[rightChild][0] > this.heap[largest][0]) {
                largest = rightChild;
            }

            if (largest === index) break;

            // Swap
            [this.heap[index], this.heap[largest]] = [this.heap[largest], this.heap[index]];
            index = largest;
        }
    }

    toArray(): Array<[number, T]> {
        return [...this.heap];
    }
}

class KDTreeNode {
    public readonly cell: HexCell;
    public readonly left: KDTreeNode | null;
    public readonly right: KDTreeNode | null;
    /** 0: x軸, 1: y軸 */
    public readonly axis: number;

    constructor(params: {
        cell: HexCell;
        left: KDTreeNode | null;
        right: KDTreeNode | null;
        axis: number;
    }) {
        this.cell = params.cell;
        this.left = params.left;
        this.right = params.right;
        this.axis = params.axis;
    }
};

// ---- KDTree 本体 ---- //
export class KDTree {
    private readonly root: KDTreeNode | null;

    constructor(points: HexCell[]) {
        this.root = points.length <= 0 ? null : this.build({
            items: points, 
            depth: 0,
        });
    }

    /** 再帰的にK-D木を構築 */
    private build(params: {
        items: HexCell[];
        depth: number;
    }): KDTreeNode | null {
        if (params.items.length === 0) return null;

        const axis = params.depth % 2; // 0: x, 1: y
        const sorted = [...params.items].sort((a, b) => {
            const av = axis === 0 ? a.centerXY.x : a.centerXY.y;
            const bv = axis === 0 ? b.centerXY.x : b.centerXY.y;
            return av - bv;
        });

        const mid = Math.floor(sorted.length / 2);

        return new KDTreeNode({
            cell: sorted[mid],
            left: this.build({
                items: sorted.slice(0, mid),
                depth: params.depth + 1,
            }),
            right: this.build({
                items: sorted.slice(mid + 1),
                depth: params.depth + 1,
            }),
            axis,
        });
    }
  
    /** 最近傍セルを返す（見つからない場合 null） */
    nearest(query: Offset): HexCell | null {
        if (!this.root) {
            return null;
        }
        return this._nearest({
            node: this.root,
            query,
            best: null,
            bestDistSq: Number.POSITIVE_INFINITY,
        });
    }
  
    /** 最近傍 + 距離 */
    nearestWithDistance(query: Offset): HexCellWithDistance | null {
        if (!this.root) {
            return null;
        }
        const cell = this.nearest(query);
        if (!cell) {
            return null;
        }
        const distance = this._distance({
            origin: query,
            dst: cell.centerXY,
        });
        return {
            cell,
            distanceMeters: distance,
        };
    }

    /** k 近傍 + 距離（距離昇順） */
    nearestKWithDistance(params: {
        query: Offset;
        k: number;
    }): HexCellWithDistance[] {
        if (params.k <= 0) {
            throw new Error("k must be positive");
        }
        if (!this.root) {
            return [];
        }

        // Max heap to maintain k nearest neighbors
        // Heap root contains the farthest of the k nearest points
        const heap = new MaxHeap<HexCell>();

        const recurse = (node: KDTreeNode) => {
            const distSq = this._squaredDistance({
                origin: params.query,
                dst: node.cell.centerXY,
            });

            // Add to heap if we have less than k elements, or if this point is closer than the farthest
            if (heap.size < params.k) {
                heap.push(distSq, node.cell);
            } else {
                const worstDistSq = heap.peek()![0];
                if (distSq < worstDistSq) {
                    heap.pop();
                    heap.push(distSq, node.cell);
                }
            }

            const axis = node.axis;
            const queryVal = axis === 0 ? params.query.x : params.query.y;
            const nodeVal = axis === 0 ? node.cell.centerXY.x : node.cell.centerXY.y;

            const nearChild = queryVal < nodeVal ? node.left : node.right;
            const farChild = queryVal < nodeVal ? node.right : node.left;

            // Search near subtree first
            if (nearChild) {
                recurse(nearChild);
            }

            // Search far subtree only if it might contain closer points
            if (farChild) {
                const axisDistSq = (queryVal - nodeVal) ** 2;
                const worstDistSq = heap.size < params.k ? Number.POSITIVE_INFINITY : heap.peek()![0];
                if (axisDistSq < worstDistSq) {
                    recurse(farChild);
                }
            }
        };

        recurse(this.root);

        // Convert heap to sorted array
        return heap
            .toArray()
            .map(([distSq, cell]) => ({
                cell,
                distanceMeters: Math.sqrt(distSq),
            }))
            .sort((a, b) => a.distanceMeters - b.distanceMeters);
    }
        

    /** 半径内（メートルなど任意単位）にあるセルを距離付きで返す（距離昇順） */
    withinRadiusWithDistance(params: {
        query: Offset;
        radius: number;
    }): HexCellWithDistance[] {
        if (params.radius < 0) {
            throw new Error("Radius must be non-negative");
        }
        if (!this.root) {
            return [];
        }

        const radiusSq = params.radius * params.radius;
        const result: HexCellWithDistance[] = [];

        const recurse = (node: KDTreeNode) => {
            const distSq = this._squaredDistance({
                origin: params.query,
                dst: node.cell.centerXY,
            });
            if (distSq <= radiusSq) {
                result.push({
                    cell: node.cell,
                    distanceMeters: Math.sqrt(distSq),
                });
            }

            const axis = node.axis;
            const queryVal = axis === 0 ? params.query.x : params.query.y;
            const nodeVal = axis === 0 ? node.cell.centerXY.x : node.cell.centerXY.y;

            const nearChild = queryVal < nodeVal ? node.left : node.right;
            const farChild = queryVal < nodeVal ? node.right : node.left;

            if (nearChild) {
                recurse(nearChild);
            }

            if (farChild) {
                const axisDistSq = (queryVal - nodeVal) ** 2;
                if (axisDistSq <= radiusSq) {
                    recurse(farChild);
                }
            }
        };

        recurse(this.root);
        return result.sort((a, b) => a.distanceMeters - b.distanceMeters);
    }

    /** 構造統計 */
    getStats(): KDTreeStats {
        return {
            nodeCount: this._countNodes(this.root),
            maxDepth: this._maxDepth(this.root),
            isEmpty: this.root === null,
        };
    }

    // ---- 内部ユーティリティ ---- //
    private _nearest(parmas: {
        node: KDTreeNode,
        query: Offset,
        best: HexCell | null,
        bestDistSq: number
    }): HexCell | null {
        const axis = parmas.node.axis;
        const queryVal = axis === 0 ? parmas.query.x : parmas.query.y;
        const nodeVal = axis === 0 ? parmas.node.cell.centerXY.x : parmas.node.cell.centerXY.y;

        const distSqHere = this._squaredDistance({
            origin: parmas.query,
            dst: parmas.node.cell.centerXY,
        });

        let currentBest = parmas.best;
        let currentBestDistSq = parmas.bestDistSq;

        if (distSqHere < currentBestDistSq) {
            currentBest = parmas.node.cell;
            currentBestDistSq = distSqHere;
        }

        const nearChild = queryVal < nodeVal ? parmas.node.left : parmas.node.right;
        const farChild = queryVal < nodeVal ? parmas.node.right : parmas.node.left;

        if (nearChild) {
            currentBest = this._nearest({
                node: nearChild,
                query: parmas.query,
                best: currentBest,
                bestDistSq: currentBestDistSq,
            });
            if (currentBest) {
                currentBestDistSq = this._squaredDistance({
                    origin: parmas.query,
                    dst: currentBest.centerXY,
                });
            }
        }

        if (farChild) {
            const axisDistSq = (queryVal - nodeVal) ** 2;
            if (axisDistSq < currentBestDistSq) {
                currentBest = this._nearest({
                    node: farChild,
                    query: parmas.query,
                    best: currentBest,
                    bestDistSq: currentBestDistSq,
                });
            }
        }

        return currentBest;
    }

    private _squaredDistance(params: {
        origin: Offset;
        dst: Offset;
    }): number {
        const dx = params.origin.x - params.dst.x;
        const dy = params.origin.y - params.dst.y;
        return dx * dx + dy * dy;
    }

    private _distance(params: {
        origin: Offset;
        dst: Offset;
    }): number {
        return Math.sqrt(this._squaredDistance(params));
    }

    private _countNodes(node: KDTreeNode | null): number {
        if (!node) return 0;
        return 1 + this._countNodes(node.left) + this._countNodes(node.right);
    }

    private _maxDepth(node: KDTreeNode | null): number {
        if (!node) return 0;
        const l = this._maxDepth(node.left);
        const r = this._maxDepth(node.right);
        return 1 + Math.max(l, r);
    }
}
