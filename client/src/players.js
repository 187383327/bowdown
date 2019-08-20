import {AnimationMixer} from 'three'

import {loader} from './loader'
import {scene} from './scene'
import {init} from './archer'
import playerX from '../models/benji.glb'

var players = { }

function initPlayers(newPlayers) {
    Object.keys(newPlayers).forEach(
        (playerUuid) => {
            addPlayer(playerUuid, newPlayers[playerUuid].x, newPlayers[playerUuid].z);
        })
}

function playAction(player, action) {
    if (player.activeAction && player.activeAction != action) {
        player.actions[player.activeAction].stop()
    } else if (player.activeAction && player.activeAction == action) {
        return
    }
    player.actions[action].reset().play()
    player.activeAction = action
}

function addPlayer(uuid, x, z) {
    // this is a hacky way to make sure the player model isn't loaded multiple times
    players[uuid] = 'loading'

    loader.load(playerX, function(player) {
        players[uuid] = player;
        var mixer = new AnimationMixer(player.scene);
        init(mixer, player);
        if (x&&z) {
            movePlayer(uuid, x, z, 0)
        }
        scene.add( player.scene );
        playAction(player, "idle")
    });
}

function animatePlayers(delta) {
    Object.keys(players).forEach(
        (playerUuid) => {
            if (players[playerUuid].mixer) {
                players[playerUuid].mixer.update(delta)
            }
        })
}

function movePlayer(playerUuid, nextPos, rotation, action) {
    var player = players[playerUuid]
    player.scene.position.copy(nextPos)
    player.scene.rotation.y = rotation
    playAction(player, action)
}

function playerAction(playerUuid, action, rotation=0) {
    var player = players[playerUuid]
    if (player && player.actions && player.actions[action]) {
        playAction(player, action)
    }
}

export { players, addPlayer, movePlayer, initPlayers, animatePlayers, playerAction }