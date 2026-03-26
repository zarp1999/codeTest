import * as THREE from 'three';
import SCENE3D_CONFIG from './Scene3DConfig.js';
 
export class QuadtreeNodeTriangle {
  constructor(boundary, depth=0, maxDepth=8, maxObjects=10) {
    this.boundary = boundary; // {min: {x,y}, max: {x,y}}
    this.children = []; // 4つの子ノード
    this.objects = []; // このノードに格納される矩形
    this.hasObject = false; // 矩形が存在するか
    this.depth = depth;
    this.maxDepth = maxDepth;
    this.maxObjects = maxObjects;
  }
 
  // 三角形を追加
  insert(tri) {
    const rectBox = tri.getBoundingBox();
 
    // このノードの境界と矩形のAABBの重なり判定
    if (!this.intersects(this.boundary, rectBox)) {
      return false; // このノードには属さない
    }
 
    // 子ノードがあれば、子に登録
    if (this.children.length > 0) {
      for (let child of this.children) {
        // 子に登録できるか試す
        child.insert(tri);
      }
      // このノードには登録しない（子に登録済み）
      this.hasObject = true;
      return true;
    }
 
    // 子に分割していない場合
    // まず、矩形をこのノードに登録
    this.objects.push(tri);
    this.hasObject = true;
 
    // 分割条件
    if (this.objects.length > this.maxObjects && this.depth < this.maxDepth) {
      this.subdivide();
 
      // 既存の矩形も子に再登録
      const oldObjects = this.objects;
      this.objects = [];
      for (let obj of oldObjects) {
        for (let child of this.children) {
          // 子に登録できるか試す
          child.insert(obj);
        }
      }
    }
    return true;
  }
 
  // 領域の分割
  subdivide() {
    const {min, max} = this.boundary;
    const midX = (min.x + max.x) / 2;
    const midY = (min.y + max.y) / 2;
 
    // 4つの子ノードの境界
    this.children.push(new QuadtreeNodeTriangle({min: {x: min.x, y: min.y}, max: {x: midX, y: midY}}, this.depth+1, this.maxDepth, this.maxObjects));
    this.children.push(new QuadtreeNodeTriangle({min: {x: midX, y: min.y}, max: {x: max.x, y: midY}}, this.depth+1, this.maxDepth, this.maxObjects));
    this.children.push(new QuadtreeNodeTriangle({min: {x: min.x, y: midY}, max: {x: midX, y: max.y}}, this.depth+1, this.maxDepth, this.maxObjects));
    this.children.push(new QuadtreeNodeTriangle({min: {x: midX, y: midY}, max: {x: max.x, y: max.y}}, this.depth+1, this.maxDepth, this.maxObjects));
  }
 
  // 領域と矩形の交差判定（AABB）
  intersects(a, b) {
    return !(a.max.x < b.min.x || a.min.x > b.max.x || a.max.y < b.min.y || a.min.y > b.max.y);
  }
}
 
export class Triangle {
  constructor(id, p1, p2, p3) {
    this.id = id; // 一意の識別子
    this.p1 = p1; // {x, y, z}
    this.p2 = p2; // {x, y, z}
    this.p3 = p3; // {x, y, z}
  }
 
  getBoundingBox() {
    const xs = [this.p1.x, this.p2.x, this.p3.x];
    const ys = [this.p1.y, this.p2.y, this.p3.y];
    return {
      min: {x: Math.min(...xs), y: Math.min(...ys)},
      max: {x: Math.max(...xs), y: Math.max(...ys)}
    };
  }
 
  getVertices() {
    return [this.p1, this.p2, this.p3];
  }
 
  getRhoRange(theta) {
    const vertices = this.getVertices();
    const rhos = vertices.map(p => p.x * Math.cos(theta) + p.y * Math.sin(theta));
    return { min: Math.min(...rhos), max: Math.max(...rhos) };
  }
}