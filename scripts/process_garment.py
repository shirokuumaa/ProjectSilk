import bpy
import sys
import os
import mathutils

def process_garment(input_path, output_path, target_height=1.3):
    # 1. Очищаем сцену от дефолтных кубов, камер и света
    bpy.ops.wm.read_factory_settings(use_empty=True)
    
    # 2. Импортируем сырую GLB модель
    print(f"📥 Импорт модели: {input_path}")
    bpy.ops.import_scene.gltf(filepath=input_path)
    
    # Ищем все меши в сцене
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not meshes:
        print("❌ Ошибка: В файле не найдено 3D-мешей.")
        sys.exit(1)
        
    # Объединяем все меши в один (если их несколько)
    bpy.ops.object.select_all(action='DESELECT')
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
        
    garment = bpy.context.active_object
    
    # 3. Нормализация масштаба
    bpy.context.view_layer.update()
    current_height = garment.dimensions.z # В Blender ось Z смотрит вверх
    
    if current_height > 0:
        scale_factor = target_height / current_height
        print(f"📏 Текущая высота: {current_height:.2f}m. Масштабируем с фактором: {scale_factor:.4f}")
        garment.scale = (scale_factor, scale_factor, scale_factor)
        
    # Применяем масштаб
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    
    # 4. Центрирование и смещение Pivot Point в самый низ модели (к полу)
    bpy.context.view_layer.update()
    bbox_corners = [garment.matrix_world @ mathutils.Vector(corner) for corner in garment.bound_box]
    
    min_x = min([c.x for c in bbox_corners])
    max_x = max([c.x for c in bbox_corners])
    min_y = min([c.y for c in bbox_corners])
    max_y = max([c.y for c in bbox_corners])
    min_z = min([c.z for c in bbox_corners])
    
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    bottom_z = min_z
    
    # Сдвигаем курсор в нижний центр и ставим туда Origin
    bpy.context.scene.cursor.location = (center_x, center_y, bottom_z)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    
    # Ставим саму модель ровно в нули координат (0, 0, 0)
    garment.location = (0, 0, 0)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    # 5. Экспорт готовой модели
    print(f"📤 Экспорт готовой модели: {output_path}")
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB',
        use_selection=True,
        export_materials='EXPORT',
        export_apply=True
    )
    print("✅ Успешно завершено!")

if __name__ == "__main__":
    # Blender передаёт свои аргументы до '--', скрипту нужны те, что после.
    try:
        argv = sys.argv
        if "--" not in argv:
            print("Укажите аргументы: blender -b -P script.py -- input.glb output.glb")
            sys.exit(1)
            
        args = argv[argv.index("--") + 1:]
        
        if len(args) < 2:
            print("❌ Использование: blender -b -P process_garment.py -- input.glb output.glb")
            sys.exit(1)
            
        in_file = os.path.abspath(args[0])
        out_file = os.path.abspath(args[1])
        
        process_garment(in_file, out_file)
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        sys.exit(1)