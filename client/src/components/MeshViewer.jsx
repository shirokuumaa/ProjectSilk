import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

export default function MeshViewer({ url, height = 520, background = "#e5e7eb" }) {
  const mountRef = useRef(null);

  useEffect(() => {
    if (!mountRef.current || !url) return;

    const mount = mountRef.current;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);

    // Camera
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    camera.position.set(0, 1.2, 2.2);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    mount.appendChild(renderer.domElement);

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(3, 5, 2);
    scene.add(dir);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Resize
    const resize = () => {
      const w = mount.clientWidth || 800;
      const h = height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    resize();

    // Load model (OBJ or GLB)
    let loaded = null;

    const fitToView = (obj) => {
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      obj.position.sub(center);

      const maxSize = Math.max(size.x, size.y, size.z) || 1;
      camera.position.set(0, maxSize * 0.8, maxSize * 2.2);
      controls.target.set(0, 0, 0);
      controls.update();
    };

    const ext = url.split("?")[0].toLowerCase();

    const onLoaded = (obj) => {
      loaded = obj;
      scene.add(obj);
      fitToView(obj);
    };

    const onError = (e) => {
      console.error("MeshViewer load error:", e);
    };

    if (ext.endsWith(".glb") || ext.endsWith(".gltf")) {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => onLoaded(gltf.scene),
        undefined,
        onError
      );
    } else if (ext.endsWith(".obj")) {
      const loader = new OBJLoader();
      loader.load(
        url,
        (obj) => onLoaded(obj),
        undefined,
        onError
      );
    } else {
      console.warn("Unknown format:", url);
    }

    // Render loop
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onWindowResize = () => resize();
    window.addEventListener("resize", onWindowResize);

    return () => {
      window.removeEventListener("resize", onWindowResize);
      cancelAnimationFrame(raf);

      controls.dispose();
      renderer.dispose();

      if (loaded) {
        loaded.traverse((child) => {
          if (child.geometry) child.geometry.dispose?.();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
            else child.material.dispose?.();
          }
        });
      }

      if (renderer.domElement && renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [url, height, background]);

  return <div ref={mountRef} style={{ width: "100%", height }} />;
}