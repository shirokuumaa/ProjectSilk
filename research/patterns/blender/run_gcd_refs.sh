#!/bin/bash
# NOT WORKING (17.10.2026), see README "дни 8–9". Day 8: Blender sim of the 3 GarmentCodeData references on their mean body; extra args are passed on
cd "$(dirname "$0")/.."
B=/Applications/Blender.app/Contents/MacOS/Blender
TAG=$1; shift
for g in 00YONAPXZE 023FMIGQK0 03EQU44RFB; do
  $B -b --factory-startup --python blender/sim_garment.py -- --panels runs/day8/$g.panels.json \
     --body data/gcd/neutral_body/mean_all.obj --body-seg .envs/src/GarmentCode/assets/bodies/ggg_body_segmentation.json \
     --out runs/day8/$TAG/$g --render "$@" 2>&1 | grep -E "SIM_STATS|Error" | cut -c1-300
  .envs/mac/bin/python blender/compare_mesh.py runs/day8/$TAG/$g/garment_sim.obj data/gcd/default_body/rand_$g/rand_${g}_sim.ply > runs/day8/$TAG/$g/compare.json
  echo "$g $(cat runs/day8/$TAG/$g/compare.json | cut -c1-120)"
done
