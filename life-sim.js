/*
 * WebGL simulation for Conway's Game of Life
 */
window.LifeSim = function(canvasId, options) {
  options = options || {};

  var dpi = window.devicePixelRatio || 1;

  var SW = window.innerWidth;
  var SH = window.innerHeight;

  options.initVFn = options.initVFn || [
    '0.0',
    '0.0'
  ];

  options.initCFn = options.initCFn || [
    'step(0.2, random(vec2(x, y)))',
    'step(0.2, random(vec2(x, y)))',
    'step(0.2, random(vec2(x, y)))',
  ];

  if (options.threshold === undefined) {
    options.threshold = false;
  }

  var WIDTH = options.size || SW;
  var HEIGHT = options.size || SH;

  var canvas = document.getElementById(canvasId);
  document.body.style.width = WIDTH + 'px';
  document.body.style.height = HEIGHT + 'px';
  canvas.style.margin = "0 0";
  canvas.style.display = "block";
  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = 'scale('+(1./dpi)+','+(1./dpi)+')';

  var gl = GL.create(canvas, {antialias: false});
  gl.canvas.width = WIDTH*dpi;
  gl.canvas.height = HEIGHT*dpi;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  // Standard 2-triangle mesh covering the viewport
  // when draw with gl.TRIANGLE_STRIP
  var standardMesh = gl.Mesh.load({
    vertices: [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1]
    ],
    coords: [
      [0, 1],
      [1, 1],
      [0, 0],
      [1, 0]
    ]
  });

  var standardVertexShaderSrc = '\
    varying vec2 textureCoord;\
    void main() {\
      textureCoord = gl_TexCoord.xy;\
      gl_Position = gl_Vertex;\
    }';

  // Given glsl expressions for r, g, b, a mapping (x, y) -> a value, return
  // a function that will paint a color generated by that function evaluated at
  // every pixel of the output buffer. (x, y) will be in the range
  // ([-1, 1], [-1, 1]).
  var makeFunctionPainter = function(r, g, b, a) {
    r = r || '0.0';
    g = g || '0.0';
    b = b || '0.0';
    a = a || '0.0';

    var shader = new gl.Shader(standardVertexShaderSrc, `
      float random(vec2 p) {
        vec2 r = vec2(23.14069263277926,2.665144142690225 );
        return fract( cos( mod( 12345678., 256. * dot(p,r) ) ) );
      }

      varying vec2 textureCoord;
      void main() {
        float x = 2.0 * textureCoord.x - 1.0;
        float y = 2.0 * textureCoord.y - 1.0;
        gl_FragColor = vec4(` + [r, g, b, a].join(',') +`);
      }
    `);

    return function() {
      shader.draw(standardMesh, gl.TRIANGLE_STRIP);
    };
  };

  // Draw a texture directly to the framebuffer.
  // Will stretch to fit, but in practice the texture and the framebuffer should be
  // the same size.
  var drawTexture = (function() {
    var shader = new gl.Shader(standardVertexShaderSrc, '\
      varying vec2 textureCoord; \
      uniform sampler2D inputTexture; \
      void main() { \
        gl_FragColor = texture2D(inputTexture, textureCoord); \
      } \
    ');
    
    return function(inputTexture) {
      inputTexture.bind(0);
      shader.uniforms({
        input: 0
      });
      shader.draw(standardMesh, gl.TRIANGLE_STRIP)
    };
  })();

  // Draw a texture to the framebuffer, thresholding at 0.5
  var drawTextureThreshold = (function() {
    var shader = new gl.Shader(standardVertexShaderSrc, '\
      varying vec2 textureCoord; \
      uniform sampler2D inputTexture; \
      void main() { \
        gl_FragColor = step(0.5, texture2D(inputTexture, textureCoord)); \
      } \
    ');

    return function(inputTexture) {
      inputTexture.bind(0);
      shader.uniforms({
        input: 0
      });
      shader.draw(standardMesh, gl.TRIANGLE_STRIP)
    };  
  })();

  var gameOfLife = (function() {
    var shader = new gl.Shader(standardVertexShaderSrc, `
      uniform sampler2D inputTexture;
      varying vec2 textureCoord;

      void main() {
        vec4 c1 = texture2D(inputTexture, (textureCoord - vec2(-1. / `+SW+`., -1. / `+SH+`.)));
        vec4 c2 = texture2D(inputTexture, (textureCoord - vec2(-1. / `+SW+`., 0)));
        vec4 c3 = texture2D(inputTexture, (textureCoord - vec2(-1. / `+SW+`., +1. / `+SH+`.)));
        vec4 c4 = texture2D(inputTexture, (textureCoord - vec2(0, -1. / `+SH+`.)));
        vec4 c5 = texture2D(inputTexture, (textureCoord - vec2(0, 0)));
        vec4 c6 = texture2D(inputTexture, (textureCoord - vec2(0, +1. / `+SH+`.)));
        vec4 c7 = texture2D(inputTexture, (textureCoord - vec2(+1. / `+SW+`., -1. / `+SH+`.)));
        vec4 c8 = texture2D(inputTexture, (textureCoord - vec2(+1. / `+SW+`., 0)));
        vec4 c9 = texture2D(inputTexture, (textureCoord - vec2(+1. / `+SW+`., +1. / `+SH+`.)));

        vec4 sum = c1 + c2 + c3 + c4 + c6 + c7 + c8 + c9;

        gl_FragColor = step(0.5, c5 * clamp(step(1.9, sum) - step(3.1, sum), 0.0, 1.0) + (1. - c5) * 
          clamp(step(2.9, sum) - step(3.1, sum), 0.0, 1.0));
      }
    `);

    return function(inputTexture) {
      inputTexture.bind(0);

      shader.uniforms({
        input: 0,
      });
      shader.draw(standardMesh, gl.TRIANGLE_STRIP);
    };
  })();

  // Apply a "splat" of change to a given place with a given
  // blob radius. The effect of the splat has an exponential falloff.
  var addSplat = (function() {
    var shader = new gl.Shader(standardVertexShaderSrc, `
      uniform vec4 change;
      uniform vec2 center;
      uniform float radius;
      uniform sampler2D inputTex;
     
      varying vec2 textureCoord;
     
      void main() {
        float dx = (center.x - textureCoord.x) * `+SW+`.;
        float dy = (center.y - textureCoord.y) * `+SH+`.;
        vec4 cur = texture2D(inputTex, textureCoord);
        gl_FragColor = cur + change * exp(-(dx * dx + dy * dy) / radius);
      }
    `);

    return function(inputTexture, change, center, radius) {
      inputTexture.bind(0);
      shader.uniforms({
        change: change,
        center: center,
        radius: radius,
        inputTex: 0
      });
      shader.draw(standardMesh, gl.TRIANGLE_STRIP);
    };
  })();

  var makeTextures = function(names) {
    var ret = {};
    names.forEach(function(name) {
      ret[name] = new gl.Texture(WIDTH, HEIGHT, {type: gl.UNSIGNED_BYTE, magFilter: gl.NEAREST});
    });

    ret.swap = function(a, b) {
      var temp = ret[a];
      ret[a] = ret[b];
      ret[b] = temp;
    };

    return ret;
  };

  var textures = makeTextures([
    'color0',
    'color1',
  ]);
  var initCFnPainter = makeFunctionPainter(options.initCFn[0],
                                           options.initCFn[1],
                                           options.initCFn[2]);

  var reset = function() {
    textures.color0.drawTo(initCFnPainter);
  };

  reset();

  // Reset the simulation on double click
  // canvas.addEventListener('dblclick', reset);

  gl.ondraw = function() {
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (options.threshold) {
      drawTextureThreshold(textures.color0);
    } else {
      drawTexture(textures.color0);
    }
  };

  gl.onupdate = function() {
    textures.color1.drawTo(function() {
      gameOfLife(textures.color0);
    });
    textures.swap('color0', 'color1');
  };

  gl.onmousemove = function(ev) {
    if (ev.dragging) {
      if ((ev.buttons & 1) !== 0) {
        textures.color1.drawTo(function() {
          addSplat(
            textures.color0,
            [10, 0, 0, 0.0],
            [ev.offsetX / WIDTH, 1.0 - ev.offsetY / HEIGHT],
            4
          );
        });
        textures.swap('color0', 'color1');
      }
    }
  };

  gl.canvas.addEventListener('contextmenu', function(ev) {
    ev.preventDefault();
  })

  gl.animate();
};
