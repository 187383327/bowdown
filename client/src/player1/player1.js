import { Vector3, Raycaster, Quaternion, Euler } from "three";

import { loader } from "../loader";
import { uuid, removeCollisionLines, localVector, getRandom, randomVector } from "../utils";
import scene from "../scene/scene";
import { sendMessage } from "../websocket";
import { init } from "../archer/archer";
import { gameOver } from "../game";
import { updateCrown } from "../kingOfCrown";
import initControls from "./controls";
import initActions from "./actions";
import camera from "../camera"
import {players} from "../players"

const benji = require.context("../../models/benji");

const velocityInfluenceModifier = 30;
const gravityAcceleration = 10;
const godMode = false;

var player1 = {
  uuid: uuid(),
  activeActions: []
};

player1.race = getRandom(["black", "brown", "white"]);

loader.load(benji("./benji_" + player1.race + ".gltf"), gltf => {
    player1.gltf = gltf;
    player1.bowState = "unequipped";

    init(player1);
    initControls(player1);
    initActions(player1);
    player1.setVelocity(new Vector3());
    player1.mixer.addEventListener("finished", event => {
      if (event.action.getClip().name == "Draw bow") {
        player1.bowState = "drawn";
      } else {
        if (event.action.getClip().name == "Fire bow") {
          player1.bowState = "equipped";
        }
        player1.idle();
      }
    });
    scene.add(player1.gltf.scene)

    player1.isFalling = function(delta) {
      if (delta) {
        var origin = this.getPosition()
          .add(this.getVelocity().multiplyScalar(delta))
          .sub(this.globalVector(new Vector3(0, 0.1, 0)));
        var dir = this.globalVector(new Vector3(0, 1, 0));
        var ray = new Raycaster(origin, dir, 0, 0.2 + this.getVelocity().length() * delta);
        var collisionResults = ray.intersectObjects(scene.getCollidableEnvironment([origin]), true);
        if (collisionResults.length > 0) {
          this.doubleJumped = false;
          return false;
        }
        return true;
      }
    };

    player1.collisionDetected = function(nextPos) {
      removeCollisionLines(this);
      var vect = nextPos.clone().sub(this.getPosition());
      //check for collisions at foot level
      var origin = this.getPosition();
      var ray = new Raycaster(origin, vect.clone().normalize(), 0, vect.length());
      var collisionResults = ray.intersectObjects(scene.triggers, true);
      if (collisionResults.length > 0) {
        let t = collisionResults[0].object
        if (t.trigger) t.trigger()
      }
      collisionResults = ray.intersectObjects(scene.getCollidableEnvironment([origin, nextPos]), true);
      if (collisionResults.length > 0) {
        return true;
      }
      return false;
    };

    player1.broadcast = async function() {
      sendMessage({
        player: this.uuid,
        position: this.getPosition(),
        velocity: this.getVelocity(),
        rotation: this.getRotation(),
        bowState: this.bowState,
        kingOfCrown: this.kingOfCrown
      });
    };

    player1.godModeOn = function() {
      return godMode && process.env.NODE_ENV == "development";
    };

    player1.doubleJumped = false;
    player1.animate = function(delta, input) {
      if (!scene.loaded) return;
      var inputDirection = this.getInputDirection(input); // Vector2 describing the direction of user input for movement
      var cameraDirection = this.getCameraDirection(); // Vector3 describing the direction the camera is pointed
      var globalDirection = this.getGlobalDirection(cameraDirection, inputDirection, input, delta); // Vector3 describing the players forward movement in the world
      var forwardDirection = this.getForwardDirection(cameraDirection); // Vector2 describing the direction the relative direction (if the player were on flat land) (not taking into account user movement input)in
      var localDirection = this.getLocalDirection(forwardDirection, inputDirection); //  Vector2 describing the direction the relative direction (if the player were on flat land)
      var nextPos, rotation;
      this.falling = this.isFalling(delta);
      if (this.godModeOn() || !this.falling) {
        if (this.getVelocity().length() > 0 && !grappling()) {
          this.setVelocity(new Vector3());
          this.broadcast();
        }
        if (this.runningInput(input)) {
          rotation = Math.atan2(localDirection.x, localDirection.y);
          nextPos = this.getPosition();
          nextPos.add(globalDirection);
          // for moving up/down slopes
          // also worth mentioning that the players movement distance will increase as it goes uphill, which should probably be fixed eventually
          let origin = nextPos.clone().add(this.globalVector(new Vector3(0, 0.25, 0)));
          let slopeRay = new Raycaster(origin, this.globalVector(new Vector3(0, -1, 0)), 0, 0.5);
          let top = slopeRay.intersectObjects(scene.getCollidableEnvironment([origin]), true);
          if (top.length > 0) {
            // the 0.01 is kinda hacky tbh
            nextPos = top[0].point.add(this.globalVector(new Vector3(0, 0.01, 0)));
          }
        } else {
          if (this.isRunning()) {
            if (this.isFiring()) {
              this.stopAction(this.activeMovement);
              this.activeMovement = null;
            } else {
              this.idle();
            }
          }
        }
      } else if (!this.godModeOn() && scene.loaded) {
        let grav = gravityAcceleration;
        // if the player is falling
        if (this.doubleJumped && this.isFiring()) {
          grav *= 0.5; //slow fall
        }
        this.velocity.sub(this.localVector(0, grav * delta, 0));
      }
      if (this.isFiring()) {
        rotation = Math.atan2(forwardDirection.x, forwardDirection.y);
        this.broadcast();
      }
      if (input.jump && !this.doubleJumped) {
        input.jump = null;
        if (this.falling) {
          this.doubleJumped = true;
          if (inputDirection.length()) {
            this.velocity.copy(globalDirection.clone().multiplyScalar(1 / delta));
          }
        }
        this.velocity.add(this.localVector(0, 7, 0));
        this.playAction("jumping");
      }
      if (velocityToPositionDelta(delta, inputDirection, cameraDirection)) {
        if (!nextPos) nextPos = this.getPosition();
        nextPos.add(this.getVelocity().multiplyScalar(delta));
      }
      if (nextPos) {
        var collision = this.collisionDetected(nextPos);
        if (this.godModeOn() || !collision) {
          this.velocity = nextPos
            .clone()
            .sub(this.getPosition())
            .multiplyScalar(1 / delta);
          updatePosition(nextPos, rotation);
          if (this.runningInput(input)) {
            this.run(); // running animation and footstep sound
          }
        } else {
          this.setVelocity(new Vector3());
        }
        this.broadcast();
      } else if (rotation) {
        updateRotation(nextPos, rotation);
      }
    };

    function updatePosition(nextPos, rotation) {
      updateRotation(nextPos, rotation);
      player1.setPosition(nextPos);
      if (player1.kingOfCrown) {
        updateCrown(player1);
      }
      camera.update()
    }

    function updateRotation(nextPos, rotation) {
      if (scene.gravityDirection == "down") {
        if (rotation) {
          player1.gltf.scene.rotation.y = rotation;
        }
      } else {
        var quat, quatVert;
        if (nextPos) {
          quatVert = nextPos.clone().normalize();
        } else {
          quatVert = player1.getPosition().normalize();
        }
        if (rotation) {
          player1.getRotation().copy(new Euler(0, rotation, 0));
          quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), quatVert);
        } else if (nextPos) {
          quat = new Quaternion().setFromUnitVectors(player1.getPosition().normalize(), quatVert);
        }
        if (quat) player1.gltf.scene.applyQuaternion(quat);
      }
    }

    function velocityToPositionDelta(delta, inputDirection, cameraDirection) {
      if (grappling()) {
        if (inputDirection.length() != 0) {
          var velocityInfluence = cameraDirection.clone().applyAxisAngle(player1.getPosition().normalize(), -Math.atan2(inputDirection.x, inputDirection.y));
          player1.addVelocity(velocityInfluence.multiplyScalar(delta));
        }
        var arrowToPlayer = player1.activeRopeArrow.position.clone().sub(player1.getPosition());
        player1.addVelocity(arrowToPlayer.normalize().multiplyScalar(velocityInfluenceModifier * delta));
        if (player1.getVelocity().angleTo(arrowToPlayer) > Math.PI / 2) {
          player1.setVelocity(player1.getVelocity().projectOnPlane(arrowToPlayer.clone().normalize()));
        }
        if (player1.sounds) {
          player1.broadcastSound("grappleReel")
        }
      }
      if (player1.getVelocity().length() != 0) {
        return player1.getVelocity().multiplyScalar(delta);
      }
    }

    player1.localVector = function(x, y, z) {
      return localVector(new Vector3(x, y, z), this.getPosition(), scene.gravityDirection);
    };

    player1.takeDamage = function(damage) {
      let hp = this.hp - damage
      this.setHp(hp)
      if (this.hp <= 0) {
        this.playAction("death");
        gameOver();
      }
    };

    player1.setHp = function(hp) {
      if (hp > 100) hp = 100
      this.hp = hp
      document.getElementById("hp").setAttribute("style", "width: " + this.hp + "%")
    }

    player1.respawn = function() {
      if (this.activeActions && this.activeActions.includes("death")) {
        this.activeActions = this.activeActions.filter(e => e != "death");
        this.anim["death"].stop();
      }
      this.removeArrows()
      var pos = randomSpawn();
      this.hp = 100;
      this.gltf.scene.visible = true;
      updatePosition(pos);
      if (scene.gravityDirection == "center") {
        this.gltf.scene.rotation.copy(new Euler())
        let quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), pos.clone().normalize())
        this.gltf.scene.applyQuaternion(quat)
      }
      // say hi to server
      sendMessage({
        player: this.uuid,
        hp: this.hp,
        position: pos,
        race: this.race,
        name: window.playerName,
        status: "respawn"
      });
      this.idle();
      
      // the hunger begins
      let hunger = setInterval(() => {
        if (player1.hp <= 0) clearInterval(hunger)
        player1.takeDamage(1)
      }, 5000)
    };

    player1.sendChat = function(message) {
      sendMessage({
        player: player1.uuid,
        name: window.playerName,
        chatMessage: message
      });
    };

    player1.run = function() {
      if (!this.isRunning()) {
        if (this.bowState == "equipped") {
          this.movementAction("runWithBow");
        } else if (this.isFiring()) {
          this.movementAction("runWithLegsOnly");
        } else {
          this.movementAction("running");
        }
        if (this.sounds) this.broadcastSound("footsteps")
      }
    };

    // this will play a sound and broadcast to the other players that the sounds needs to be played for this player
    player1.broadcastSound = function(sound) {
      this.playSound(sound)
      sendMessage({
        player: this.uuid,
        playSound: sound
      })
    }
    
    player1.broadcastStopSound = function(sound) {
      this.stopSound(sound)
      sendMessage({
        player: this.uuid,
        stopSound: sound
      })
    }

    function grappling() {
      return player1.activeRopeArrow != null && player1.activeRopeArrow.stopped;
    }

    player1.equipBow();
  },
  bytes => {
    console.log("player1 " + Math.round((bytes.loaded / bytes.total) * 100) + "% loaded");
  }
)

function randomSpawn() {
  let c = players.count()
  // this should be moved to the server
  if (scene.gravityDirection == "down") {
    return new Vector3(-13, 10, -9);
  }
  if (process.env.NODE_ENV == "development") {
    return new Vector3(0, -120, 0);
  }
  if (c > 0) {
    let p = players.all()
    try {
      let pos = p[getRandom(Object.keys(p))].getPosition() // get a random player's position
      if (scene.gravityDirection == "center" && pos.length() < 80) {
        throw "somethings fucked with the other players position"
      }
      return pos.add(randomVector().projectOnPlane(pos).normalize().multiplyScalar(25)).multiplyScalar(1.4) // spawn near that player, but not too close
    } catch (error) {
      console.error(error);
    }
  }
  return new Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(150);
}

export default player1;
