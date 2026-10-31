/**
 * dsh-handtrack client half
 *
 * Loads Three.js + MediaPipe Hands from CDN, then renders a full-3D panel:
 *   - Webcam feed as background
 *   - Skeletal hand overlay (live landmark detection)
 *   - 3D robot avatar with spring-strings from finger tips to joints
 *   - Mouse drag to orbit camera, scroll to zoom
 *
 * Panel is a draggable float-window anchored to the DSH web shell.
 */
window.__ModuleLoader__.load({
  id: 'dsh-handtrack',
  factory: function (require) {
    'use strict'

    var React = require('react')
    var el = React.createElement

    // ── Config ───────────────────────────────────────────────────────────────
    var W = 1400, H = 750
    var CAM_W = 640, CAM_H = 480
    var FPS = 30

    // Finger-tip → robot joint mapping (same as Python version)
    var FINGER_JOINT = ['left_shoulder','left_elbow','head','right_elbow','right_shoulder']
    var FINGER_TIP_MP = [4, 8, 12, 16, 20]  // MediaPipe landmark indices
    var FINGER_NAMES  = ['Thumb','Index','Middle','Ring','Pinky']
    var FINGER_COLORS = [
      [1.0,0.2,0.2],[1.0,0.6,0.0],[1.0,1.0,0.2],[0.2,1.0,0.2],[0.2,0.6,1.0]
    ]

    // Robot joint rest positions
    var ROBOT_JOINTS = {
      head:        [0.0,  1.8, 0.0],
      left_shoulder: [-0.8, 1.2, 0.0],
      left_elbow:  [-1.2, 0.6, 0.0],
      right_shoulder: [0.8, 1.2, 0.0],
      right_elbow: [1.2,  0.6, 0.0],
      torso:       [0.0,  0.8, 0.0],
      left_hip:    [-0.4, 0.4, 0.0],
      right_hip:   [0.4,  0.4, 0.0],
    }

    var SMOOTH_WIN = 5
    var STRING_COLOR = [0.0, 1.0, 0.8]
    var ROBOT_COLOR  = 0x4488ff
    var GROUND_COLOR = 0x111122
    var BG_COLOR     = [0.02, 0.02, 0.05]

    // ── State ────────────────────────────────────────────────────────────────
    var smoothed = {}
    for (var i = 0; i < 5; i++) smoothed[i] = []

    var robotJoints = {}
    for (var k in ROBOT_JOINTS) robotJoints[k] = new Float32Array(ROBOT_JOINTS[k])

    var cameraAngleY = 30, cameraAngleX = 10, cameraDist = 5
    var isDragging = false, lastMX = 0, lastMY = 0

    // ── Three.js scene (lazy init when component mounts) ─────────────────────
    var scene, camera, renderer, clock
    var handLines = []   // THREE.Line per finger
    var stringLines = [] // THREE.Line per string
    var robotMeshes = {} // sphere per joint
    var groundMesh, gridHelper
    var loaded = false

    function ensureThree () {
      if (loaded) return
      loaded = true

      scene = new THREE.Scene()
      scene.background = new THREE.Color(BG_COLOR[0], BG_COLOR[1], BG_COLOR[2])
      scene.fog = new THREE.FogExp2(new THREE.Color(BG_COLOR[0], BG_COLOR[1], BG_COLOR[2]), 0.04)

      camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100)
      updateCameraPos()

      renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setSize(W, H)
      renderer.setPixelRatio(window.devicePixelRatio)

      // Lights
      var amb = new THREE.AmbientLight(0x404060, 0.8)
      scene.add(amb)
      var dir = new THREE.DirectionalLight(0xffffff, 1.2)
      dir.position.set(3, 5, 4)
      scene.add(dir)
      var rim = new THREE.PointLight(0x4488ff, 0.6, 10)
      rim.position.set(-3, 2, -2)
      scene.add(rim)

      // Ground plane
      groundMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshStandardMaterial({ color: GROUND_COLOR, roughness: 0.9 })
      )
      groundMesh.rotation.x = -Math.PI / 2
      groundMesh.position.y = -1.0
      scene.add(groundMesh)

      gridHelper = new THREE.GridHelper(20, 20, 0x222244, 0x111133)
      gridHelper.position.y = -0.99
      scene.add(gridHelper)

      // Robot joint spheres
      var sphereGeo = new THREE.SphereGeometry(0.08, 16, 16)
      var bodyMat = new THREE.MeshStandardMaterial({ color: ROBOT_COLOR, emissive: 0x2244aa, emissiveIntensity: 0.3 })
      for (var j in ROBOT_JOINTS) {
        var m = new THREE.Mesh(sphereGeo, bodyMat.clone())
        m.position.set.apply(m.position, ROBOT_JOINTS[j])
        scene.add(m)
        robotMeshes[j] = m
      }

      // Hand skeleton lines (will be updated each frame)
      var lineMat = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 })
      var bonePairs = [
        [0,1],[1,2],[2,3],[3,4],       // thumb
        [0,5],[5,6],[6,7],[7,8],       // index
        [5,9],[9,10],[10,11],[11,12],  // middle
        [12,13],[13,14],[14,15],[15,16],[12,17],[17,18],[18,19],[19,20], // ring+pinky
        [5,9],[9,13],[13,17]            // palm connections
      ]
      var handPoints = new Float32Array(21 * 3)
      var handGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(handPoints, 3))
      var handLine = new THREE.Line(handGeo, new THREE.LineBasicMaterial({ color: 0x00ffaa }))
      handLine.visible = false
      scene.add(handLine)
      window._handLine = handLine
      window._handPoints = handPoints

      // String lines (finger tip → robot joint)
      for (var f = 0; f < 5; f++) {
        var pts = new Float32Array(6) // 2 points × 3
        var geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pts, 3))
        var mat = new THREE.LineBasicMaterial({
          color: new THREE.Color(FINGER_COLORS[f][0], FINGER_COLORS[f][1], FINGER_COLORS[f][2]),
          transparent: true, opacity: 0.7
        })
        var ln = new THREE.Line(geo, mat)
        ln.visible = false
        scene.add(ln)
        stringLines.push(ln)
      }

      // Initial camera pos
      updateCameraPos()
    }

    function updateCameraPos () {
      var radY = cameraAngleY * Math.PI / 180
      var radX = cameraAngleX * Math.PI / 180
      camera.position.set(
        cameraDist * Math.sin(radY) * Math.cos(radX),
        cameraDist * Math.sin(radX) + 1.0,
        cameraDist * Math.cos(radY) * Math.cos(radX)
      )
      camera.lookAt(0, 0.5, 0)
    }

    // ── Camera setup ─────────────────────────────────────────────────────────
    var videoEl, mpHands, mpVis
    var camReady = false

    function initCamera () {
      videoEl = document.createElement('video')
      videoEl.style.cssText = 'position:absolute;top:10px;left:10px;width:320px;height:240px;border-radius:8px;opacity:0.85;z-index:10;pointer-events:none'
      document.body.appendChild(videoEl)

      navigator.mediaDevices.getUserMedia({ video: { width: CAM_W, height: CAM_H, facingMode: 'user' } })
        .then(function (stream) {
          videoEl.srcObject = stream
          camReady = true
        })
        .catch(function (err) {
          console.warn('[handtrack] camera unavailable:', err.message)
          camReady = false
        })
    }

    function loadMediaPipe () {
      return Promise.all([
        loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js'),
        loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1675466862/camera_utils.js'),
        loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1675464158/drawing_utils.js')
      ]).then(function () {
        mpHands = new Hands({
          locateFile: function (file) {
            return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/' + file
          }
        })
        mpHands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 })
        mpHands.onResults(onHandResults)
      })
    }

    function loadScript (url) {
      return new Promise(function (resolve, reject) {
        if (document.querySelector('script[src="'+url+'"]')) { resolve(); return }
        var s = document.createElement('script')
        s.src = url; s.onload = resolve; s.onerror = reject
        document.head.appendChild(s)
      })
    }

    function onHandResults (results) {
      if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) {
        window._handLine.visible = false
        for (var i = 0; i < stringLines.length; i++) stringLines[i].visible = false
        return
      }

      var landmarks = results.multiHandLandmarks[0]
      window._handLine.visible = true

      // Draw hand skeleton
      var pts = window._handPoints
      for (var i = 0; i < 21; i++) {
        pts[i*3]   = (0.5 - landmarks[i].x) * 4.0
        pts[i*3+1] = (0.5 - landmarks[i].y) * 3.0
        pts[i*3+2] = -landmarks[i].z * 2.0
      }
      window._handLine.geometry.attributes.position.needsUpdate = true

      // Update strings (finger tips → robot joints)
      for (var f = 0; f < 5; f++) {
        var tip = landmarks[FINGER_TIP_MP[f]]
        // Smooth
        var buf = smoothed[f]
        buf.push([(0.5 - tip.x) * 4.0, (0.5 - tip.y) * 3.0, -tip.z * 2.0])
        if (buf.length > SMOOTH_WIN) buf.shift()
        var avg = [0,0,0]
        for (var s = 0; s < buf.length; s++) { avg[0]+=buf[s][0]; avg[1]+=buf[s][1]; avg[2]+=buf[s][2] }
        avg[0]/=buf.length; avg[1]/=buf.length; avg[2]/=buf.length

        var jointName = FINGER_JOINT[f]
        var jp = robotJoints[jointName] || new Float32Array(3)

        var geo = stringLines[f].geometry
        var pos = geo.attributes.position.array
        pos[0]=avg[0]; pos[1]=avg[1]; pos[2]=avg[2]
        pos[3]=jp[0]; pos[4]=jp[1]; pos[5]=jp[2]
        geo.attributes.position.needsUpdate = true
        stringLines[f].visible = true
      }
    }

    // ── Render loop ──────────────────────────────────────────────────────────
    var animId = null
    var fpsFrames = 0, fpsTime = 0, currentFps = 0

    function startLoop () {
      clock = new THREE.Clock()
      function tick () {
        animId = requestAnimationFrame(tick)
        var dt = clock.getDelta()
        fpsFrames++; fpsTime += dt
        if (fpsTime >= 1.0) { currentFps = fpsFrames; fpsFrames = 0; fpsTime = 0 }

        // Idle robot animation
        var t = clock.getElapsedTime()
        for (var k in robotMeshes) {
          var base = ROBOT_JOINTS[k]
          var m = robotMeshes[k]
          m.position.y = (base ? base[1] : 0) + Math.sin(t * 0.8 + (base ? base[1]*2 : 0)) * 0.05
        }

        renderer.render(scene, camera)
      }
      tick()
    }

    function stopLoop () {
      if (animId) { cancelAnimationFrame(animId); animId = null }
    }

    // ── Mouse controls ───────────────────────────────────────────────────────
    function setupControls (canvas) {
      canvas.addEventListener('mousedown', function (e) { isDragging = true; lastMX = e.clientX; lastMY = e.clientY })
      canvas.addEventListener('mouseup',   function () { isDragging = false })
      canvas.addEventListener('mouseleave',function () { isDragging = false })
      canvas.addEventListener('mousemove', function (e) {
        if (!isDragging) return
        var dx = e.clientX - lastMX, dy = e.clientY - lastMY
        cameraAngleY -= dx * 0.3
        cameraAngleX = Math.max(-80, Math.min(80, cameraAngleX + dy * 0.3))
        updateCameraPos()
        lastMX = e.clientX; lastMY = e.clientY
      })
      canvas.addEventListener('wheel', function (e) {
        e.preventDefault()
        cameraDist = Math.max(2, Math.min(12, cameraDist + e.deltaY * 0.005))
        updateCameraPos()
      }, { passive: false })
    }

    // ── Resize handler ───────────────────────────────────────────────────────
    function onResize () {
      if (!renderer) return
      var w = window.innerWidth, h = window.innerHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }

    // ── React component ──────────────────────────────────────────────────────
    var panelVisible = false
    var containerRef = null

    function HandtrackPanel () {
      var mounted = React.useRef(false)

      React.useEffect(function () {
        mounted.current = true
        ensureThree()
        initCamera()
        loadMediaPipe().then(function () {
          if (!mounted.current) return
          startLoop()
          window.addEventListener('resize', onResize)
        })
        return function () {
          mounted.current = false
          stopLoop()
          window.removeEventListener('resize', onResize)
          if (videoEl && videoEl.srcObject) videoEl.srcObject.getTracks().forEach(function(t){ t.stop() })
          if (renderer) renderer.dispose()
        }
      }, [])

      return el('div', {
        style: {
          position: 'fixed', bottom: 100, right: 20,
          width: Math.min(W, window.innerWidth - 40),
          height: Math.min(H, window.innerHeight - 120),
          zIndex: 9999, borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 0 40px rgba(0,150,255,0.3)',
          border: '1px solid rgba(100,180,255,0.3)',
          background: '#000'
        }
      },
        el('canvas', {
          ref: function (c) {
            if (c && !containerRef) {
              containerRef = c
              setupControls(c)
            }
          },
          style: { width: '100%', height: '100%', display: 'block' }
        }),
        el('div', {
          style: {
            position: 'absolute', top: 10, right: 10, zIndex: 2,
            color: '#0f8', fontFamily: 'Consolas,monospace', fontSize: 13,
            background: 'rgba(0,0,0,0.5)', padding: '6px 10px', borderRadius: 6,
            pointerEvents: 'none'
          }
        },
          el('div', null, 'AI AGENT: ' + (camReady ? 'ACTIVE' : 'STANDBY')),
          el('div', { style: { color: '#888', fontSize: 11 } }, 'drag to orbit · scroll to zoom · ESC close')
        )
      )
    }

    // ── Register panel in DSH shell ─────────────────────────────────────────
    var ctx = window.__dshCtx__
    if (ctx) {
      ctx.systemPrompt.context({
        name: 'handtrack-status',
        order: 900,
        text: function () { return '' }
      })
    }

    // ── Expose toggle via global (for testing) ─────────────────────────────
    window._handtrackVisible = false
    window.toggleHandtrack = function () {
      panelVisible = !panelVisible
      window._handtrackVisible = panelVisible
      var existing = document.getElementById('dsh-handtrack-root')
      if (panelVisible) {
        if (!existing) {
          var root = document.createElement('div')
          root.id = 'dsh-handtrack-root'
          document.body.appendChild(root)
        }
        React.createElement(React.StrictMode, null, el(HandtrackPanel))
      } else {
        if (existing) existing.remove()
      }
    }

    // Auto-show on load
    setTimeout(function () { window.toggleHandtrack() }, 500)

    return { exports: {} }
  }
})
