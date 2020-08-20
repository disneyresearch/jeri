attribute vec3 aVertexPosition;
attribute vec2 aTextureCoord;
varying vec2 vTextureCoord;
uniform mat4 viewMatrix;
void main(void) {
    gl_Position = viewMatrix * vec4(aVertexPosition, 1.0);
    vTextureCoord = aTextureCoord;
}
