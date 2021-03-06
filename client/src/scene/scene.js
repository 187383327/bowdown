import { Scene, TextureLoader, MeshBasicMaterial, BoxGeometry, Mesh, BackSide, Group, Vector3, DirectionalLight, AmbientLight} from 'three'

import { loader } from '../loader'
import {connectToServer} from '../websocket'
import {createTextMesh} from '../utils'
import lobby from './lobby'
import {sunLightColor} from '../constants'

import spatialIndex from '../../spatialIndex.json'

// const maps = require.context('../models/maps');

var scene = new Scene();
scene.loaded = false
var collidableEnvironment = []
const indexMod = 5 // if you change this you need to change it on the indexer too
var objects = {}
scene.triggers = []
scene.gravityDirection = "down"

let defaultLight = new DirectionalLight(sunLightColor, 3)
scene.add(new AmbientLight(sunLightColor, 1.5))
scene.add(defaultLight) 

scene.add(lobby)
scene.triggers.push(lobby.faceWorldBox)
collidableEnvironment = [lobby.platform]
scene.loaded = true
import(/* webpackMode: "lazy" */ '../../models/maps/lowild.glb').then( file => {
    var lowild
    loader.load(file.default, (gltf) => {
        lowild = gltf.scene;
        lowild.children.forEach((child) => {
            if (objects[child.name]) throw "all object names bust be unique"
            objects[child.name] = child
        })
        lobby.faceWorldBox.material.color.set(0x138E55)
        lobby.remove(lobby.loadingText)
        let readyText = createTextMesh(['ready'], 0x138E55, 1, new Vector3(-3, 1, -8))
        let readyHelpText = createTextMesh(['go into the cube'], 0x138E55, 0.5, new Vector3(-4.5, 0.3, -8))
        scene.add(readyText)
        scene.add(readyHelpText)
        lobby.faceWorldBox.trigger = function() {
            scene.add(lowild)
            scene.remove(lobby)
            scene.gravityDirection = "center"
            collidableEnvironment = [lowild]
            scene.loadSkyBox()
            scene.loadSkyLight()
            scene.loadBackgroundMusic()
            scene.removeTrigger(this)
            if (process.env.NODE_ENV == 'development') {
                connectToServer("ws://localhost:18181")
            } else {
                connectToServer("wss://ws.bowdown.io:18181")
            }
        }
    })
})

scene.removeTrigger = function(trigger) { // trigger is an Object3D
    scene.remove(trigger)
    scene.triggers.splice(scene.triggers.indexOf(trigger), 1)
}

scene.loadMap = function(map, gravityDirection) {
    scene.gravityDirection = gravityDirection
    loadingIndicator.add()
    loader.load(map, function (gltf) {
        loadingIndicator.remove()
        var mesh = gltf.scene;
        mesh.children.forEach((child) => {
            if (objects[child.name]) throw "all object names bust be unique"
            objects[child.name] = child
        })
        scene.add(mesh);
        collidableEnvironment = [mesh]
        scene.loaded = true
    }, function(bytes) {
        loadingIndicator.update(Math.round((bytes.loaded / bytes.total)*100) + "%")
    });
}

const loadingIndicator = {
    add: function() {
        var indicator = document.createElement("p")
        indicator.innerText = "loading map"
        indicator.id = "loading-indicator"
        document.body.append(indicator);
    },
    remove: function() {
        var indicator = document.getElementById("loading-indicator")
        if (indicator) {
            document.getElementById("loading-indicator").remove()
        }
    },
    update: function(percentString) {
        var indicator = document.getElementById("loading-indicator")
        if (indicator) {
            indicator.innerText = percentString
        }
    }
}

scene.loadSkyBox = function() {
    var materialArray = [];  
    ["ft", "bk", "up", "dn", "rt", "lf"].forEach((face) => {
        import(/* webpackMode: "lazy-once" */ `../../skybox/bluecloud_${face}.jpg`).then(image => {
            let mat = new MeshBasicMaterial( { map: new TextureLoader().load(image.default) });
            mat.side = BackSide;
            materialArray.push(mat);
            if (materialArray.length == 6 && skybox == null) {
                for (let i = 0; i < 6; i++)
                    materialArray[i].side = BackSide;
                let skyboxGeo = new BoxGeometry(5000, 5000, 5000);
                skybox = new Mesh( skyboxGeo, materialArray );
                scene.add( skybox );
            }
        })
    })
}

scene.loadBackgroundMusic = function() {
    import('../../audio/Background Drum Loop.mp3').then(file => {
        var song = new Audio(file.default);
        song.addEventListener("load", function() {
            song.play();
        }, true);
        song.autoplay=true
        song.loop=true
        song.volume = 0.025
        song.load()
    })
}

scene.loadSkyLight = function() {
    scene.remove(defaultLight)
    var dirLight = new DirectionalLight(sunLightColor, 0.5)
    skyLight.add(dirLight)
    dirLight = new DirectionalLight(sunLightColor, 0.5)
    dirLight.position.set(0, -1, 0)
    skyLight.add(dirLight)
    dirLight = new DirectionalLight(sunLightColor, 0.5)
    dirLight.position.set(1, 0, 0)
    skyLight.add(dirLight)
    dirLight = new DirectionalLight(sunLightColor, 0.5)
    dirLight.position.set(-1, 0, 0)
    skyLight.add(dirLight)
    dirLight = new DirectionalLight(sunLightColor, 0.5)
    dirLight.position.set(0, 0, 1)
    skyLight.add(dirLight)
    dirLight = new DirectionalLight(sunLightColor, 0.5)
    dirLight.position.set(0, 0, -1)
    skyLight.add(dirLight)
    scene.add(skyLight)
}

var skybox
let skyLight = new Group()
scene.animate = function(delta) {
    if (skybox) {
        skybox.rotateOnAxis(new Vector3(0,1,0), delta/20)
    }
    if (skyLight) {
        skyLight.rotateOnAxis(new Vector3(0,1,0), delta/20)
    }
}

scene.getCollidableEnvironment = function(positions) {
    if (!scene.loaded) return []
    if (this.gravityDirection == "down") { // create spatial index for garden
        return collidableEnvironment
    }
    var collidable = []
    if (positions) {
        positions.forEach((position) => {
            var pos = position.clone().normalize().multiplyScalar(indexMod)
            var collisions = spatialIndex[Math.floor(pos.x)+indexMod][Math.floor(pos.y)+indexMod][Math.floor(pos.z)+indexMod]
            collisions.forEach((collision) => {
                if (objects[collision]) {
                    collidable.push(objects[collision])
                } else {
                    console.error(collision + " not found in objects, you need to recreate the spatialIndex")
                }
            })
        })
    }
    if (collidable.length == 0) {
        console.warn("detecting collisions against the entire world")
        collidable = collidableEnvironment
    }
    return collidable
}

export default scene