// Prototype identity matrix
const IDENTITY4x4 = new Float32Array(16);
for (let i = 0; i < 4; ++i) {
    IDENTITY4x4[i + 4 * i] = 1.0;
}

export class Matrix4x4 {

    data: Float32Array;

    static create(): Matrix4x4 {
        return new Matrix4x4;
    }

    static fromScaling(matrix: Matrix4x4, scaling: number[]): void {
        if (scaling.length !== 3) {
            throw new Error('Matrix4x4.fromScaling requires a 3-dimentional vector as input');
        }
        scaling.forEach((scale, i) => {
            matrix.data[i + 4 * i] = scale;
        });
    }

    static multiply(output: Matrix4x4, a: Matrix4x4, b: Matrix4x4): void {
        const data = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        for (let i = 0; i < 4; ++i) {
            for (let j = 0; j < 4; ++j) {
                for (let k = 0; k < 4; ++k) {
                    data[4 * j + i] += a.data[4 * k + i] * b.data[4 * j + k];
                }
            }
        }
        output.data = data;
    }

    static scale(output: Matrix4x4, a: Matrix4x4, scale: number[]) {
        if (scale.length !== 3) {
            throw new Error('Matrix4x4.scale expects the third argument to have 3 numbers');
        }
        const data = new Float32Array(a.data);
        for (let i = 0; i < 3; ++i) {
            for (let j = 0; j < 4; ++j) {
                data[4 * i + j] *= scale[i];
            }
        }
        output.data = data;
    }

    static translate(output: Matrix4x4, a: Matrix4x4, translation: number[]) {
        if (translation.length !== 3) {
            throw new Error('Matrix4x4.translate expects the third argument to have 3 numbers');
        }
        const data = new Float32Array(a.data);
        for (let i = 0; i < 4; ++i) {
            for (let j = 0; j < 3; ++j) {
                data[12 + i] += a.data[4 * j + i] * translation[j];
            }
        }
        output.data = data;
    }

    static clone(a: Matrix4x4): Matrix4x4 {
        return new Matrix4x4(a.data);
    }

    static invert(output: Matrix4x4, matrix: Matrix4x4): void {
        const m = matrix.data;
        const o = output.data;
        // tslint:disable:whitespace
        // tslint:disable:max-line-length
        o[0]  = -m[7]*m[10]*m[13] + m[6]*m[11]*m[13] + m[7]*m[9]*m[14] - m[5]*m[11]*m[14] - m[6]*m[9]*m[15] + m[5]*m[10]*m[15];
        o[1]  =  m[3]*m[10]*m[13] - m[2]*m[11]*m[13] - m[3]*m[9]*m[14] + m[1]*m[11]*m[14] + m[2]*m[9]*m[15] - m[1]*m[10]*m[15];
        o[2]  = -m[3]*m[6]*m[13]  + m[2]*m[7]*m[13]  + m[3]*m[5]*m[14] - m[1]*m[7]*m[14]  - m[2]*m[5]*m[15] + m[1]*m[6]*m[15];
        o[3]  =  m[3]*m[6]*m[9]   - m[2]*m[7]*m[9]   - m[3]*m[5]*m[10] + m[1]*m[7]*m[10]  + m[2]*m[5]*m[11] - m[1]*m[6]*m[11];
        o[4]  =  m[7]*m[10]*m[12] - m[6]*m[11]*m[12] - m[7]*m[8]*m[14] + m[4]*m[11]*m[14] + m[6]*m[8]*m[15] - m[4]*m[10]*m[15];
        o[5]  = -m[3]*m[10]*m[12] + m[2]*m[11]*m[12] + m[3]*m[8]*m[14] - m[0]*m[11]*m[14] - m[2]*m[8]*m[15] + m[0]*m[10]*m[15];
        o[6]  =  m[3]*m[6]*m[12]  - m[2]*m[7]*m[12]  - m[3]*m[4]*m[14] + m[0]*m[7]*m[14]  + m[2]*m[4]*m[15] - m[0]*m[6]*m[15];
        o[7]  = -m[3]*m[6]*m[8]   + m[2]*m[7]*m[8]   + m[3]*m[4]*m[10] - m[0]*m[7]*m[10]  - m[2]*m[4]*m[11] + m[0]*m[6]*m[11];
        o[8]  = -m[7]*m[9]*m[12]  + m[5]*m[11]*m[12] + m[7]*m[8]*m[13] - m[4]*m[11]*m[13] - m[5]*m[8]*m[15] + m[4]*m[9]*m[15];
        o[9]  =  m[3]*m[9]*m[12]  - m[1]*m[11]*m[12] - m[3]*m[8]*m[13] + m[0]*m[11]*m[13] + m[1]*m[8]*m[15] - m[0]*m[9]*m[15];
        o[10] = -m[3]*m[5]*m[12]  + m[1]*m[7]*m[12]  + m[3]*m[4]*m[13] - m[0]*m[7]*m[13]  - m[1]*m[4]*m[15] + m[0]*m[5]*m[15];
        o[11] =  m[3]*m[5]*m[8]   - m[1]*m[7]*m[8]   - m[3]*m[4]*m[9]  + m[0]*m[7]*m[9]   + m[1]*m[4]*m[11] - m[0]*m[5]*m[11];
        o[12] =  m[6]*m[9]*m[12]  - m[5]*m[10]*m[12] - m[6]*m[8]*m[13] + m[4]*m[10]*m[13] + m[5]*m[8]*m[14] - m[4]*m[9]*m[14];
        o[13] = -m[2]*m[9]*m[12]  + m[1]*m[10]*m[12] + m[2]*m[8]*m[13] - m[0]*m[10]*m[13] - m[1]*m[8]*m[14] + m[0]*m[9]*m[14];
        o[14] =  m[2]*m[5]*m[12]  - m[1]*m[6]*m[12]  - m[2]*m[4]*m[13] + m[0]*m[6]*m[13]  + m[1]*m[4]*m[14] - m[0]*m[5]*m[14];
        o[15] = -m[2]*m[5]*m[8]   + m[1]*m[6]*m[8]   + m[2]*m[4]*m[9]  - m[0]*m[6]*m[9]   - m[1]*m[4]*m[10] + m[0]*m[5]*m[10];
        // tslint:enable:whitespace
        // tslint:enable:max-line-length

        const determinant = m[0] * o[0] + m[1] * o[4] + m[2] * o[8] + m[3] * o[12];

        if (determinant === 0.0) {
            throw new Error('Matrix is not invertible.');
        }

        const inverseDeterminant = 1.0 / determinant;

        for (let i = 0; i < 16; ++i) {
            o[i] *= inverseDeterminant;
        }
    }

    constructor(buffer: Float32Array = IDENTITY4x4) {
        this.data = new Float32Array(buffer);
    }

}

export class Vector4 {

    data: Float32Array;

    static create(): Vector4 {
        return new Vector4;
    }

    static set(output: Vector4, x: number, y: number, z: number, w: number): void {
        output.data[0] = x;
        output.data[1] = y;
        output.data[2] = z;
        output.data[3] = w;
    }

    static fromValues(x: number, y: number, z: number, w: number): Vector4 {
        const vector = new Vector4;
        Vector4.set(vector, x, y, z, w);
        return vector;
    }

    static transformMat4(output: Vector4, vector: Vector4, matrix: Matrix4x4) {
        const v = vector.data;
        const m = matrix.data;
        const data = new Float32Array([0, 0, 0, 0]);
        for (let i = 0; i < 4; ++i) {
            for (let j = 0; j < 4; ++j) {
                data[i] += v[j] * m[4 * j + i];
            }
        }
        output.data = data;
    }

    constructor() {
        this.data = new Float32Array([0, 0, 0, 0]);
    }
}

// function assertEqual(a: mat4 | vec4, b: Matrix4x4 | Vector4, message: string): void {
//     for (let i = 0; i < a.length; ++i) {
//         if (Math.abs(a[i] - b.data[i]) > 0.001) {
//             throw new Error('Failed:' + message + '\n' + a + '\n' + b.data);
//         }
//     }
// }

// function test() {
//     const a = mat4.create();
//     const b = Matrix4x4.create();

//     assertEqual(a, b, 'after creation');

//     for (let ii = 0; ii < 16; ++ii) {
//         a[ii] = b.data[ii] = Math.random();
//     }

//     const c = mat4.create();
//     const d = Matrix4x4.create();

//     mat4.fromScaling(c, [4, 3, 2]);
//     Matrix4x4.fromScaling(d, [4, 3, 2]);

//     assertEqual(c, d, 'fromScaling');

//     mat4.translate(c, a, [2, 3, 4]);
//     Matrix4x4.translate(d, b, [2, 3, 4]);
//     // assertEqual(a, b, 'after translation ab');
//     assertEqual(c, d, 'after translation cd');

//     mat4.scale(a, c, [2, 3, 4]);
//     Matrix4x4.scale(b, d, [2, 3, 4]);
//     assertEqual(a, b, 'after scaling ab');
//     // assertEqual(c, d, 'after scaling cd');

//     mat4.translate(c, a, [2, 3, 4]);
//     Matrix4x4.translate(d, b, [2, 3, 4]);
//     // assertEqual(a, b, 'after translation again ab');
//     assertEqual(c, d, 'after translation again cd');

//     mat4.invert(a, c);
//     Matrix4x4.invert(b, d);
//     assertEqual(a, b, 'after invert ab');
//     assertEqual(c, d, 'after invert cd');

//     const e = mat4.create();
//     const f = Matrix4x4.create();

//     mat4.multiply(e, c, a);
//     Matrix4x4.multiply(f, d, b);
//     assertEqual(e, f, 'after multiply ef');
//     assertEqual(c, d, 'after multiply cd');
//     assertEqual(a, b, 'after multiply ab');

//     mat4.scale(a, c, [5, -3, 4]);
//     Matrix4x4.scale(b, d, [5, -3, 4]);
//     assertEqual(a, b, 'after scaling again ab');
//     assertEqual(c, d, 'after scaling again cd');
//     // assertEqual(c, d, 'after scaling cd');

//     const q = mat4.clone(a);
//     const i = Matrix4x4.clone(b);
//     assertEqual(q, i, 'after cloning');

//     const v1 = vec4.create();
//     const w1 = Vector4.create();
//     assertEqual(v1, w1, 'vectors after init');

//     vec4.set(v1, 3, 4, 5, 6);
//     Vector4.set(w1, 3, 4, 5, 6);
//     assertEqual(v1, w1, 'vectors after set');

//     const v2 = vec4.fromValues(6, 5, 4, 3);
//     const w2 = Vector4.fromValues(6, 5, 4, 3);
//     assertEqual(v2, w2, 'vectors after fromValues');

//     vec4.transformMat4(v1, v2, a);
//     Vector4.transformMat4(w1, w2, b);
//     assertEqual(v1, w1, 'vectors after tranformMat4');
// }
