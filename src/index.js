import $ from 'jquery';
import './style.css';
import { setupTouchControls } from './touch-controls.js';

var player = {
    health: {
        remain: 100, 
        total: 100
    },
    step: 20
};
var itemsCount = 10;
var enemiesCount = 6;
var enemy = {
    hit: {
        force: 5
    }
};
var viewport = {};
var $player = null;

$(document).ready(() => {
    var $viewport = $(window);
    viewport.width = $viewport.width();
    viewport.height = $viewport.height();
    $player = $('#player');
    $player.css({
        left: Math.round(viewport.width / 2 - $player.width() / 2), 
        top: Math.round(viewport.height / 2 - $player.height() / 2)
    });

    distributeItems();
    distributeEnemies();
    $('#player, .item, .enemy').each((i, elem) => fitToViewport($(elem)));
    $viewport.on('resize', resizeField);
    const dispatchKey = (type, code) => {
        $(document).trigger($.Event(type, { which: code, keyCode: code }));
    };
    setupTouchControls({
        isFinished: () => player.dead || player.won,
        onKeyDown: code => dispatchKey('keydown', code),
        onKeyUp: code => dispatchKey('keyup', code)
    });
    $('#close-game-help').on('click', e => {
        e.currentTarget.blur();
        $('#game-help').prop('hidden', true);
    });

    var pressedCodes = {};
    
    $(document).on('keydown keyup', e => {
        var isPressed = e.type == 'keydown';
        var code = e.keyCode || e.which;
        var isButton = $(e.target).closest('button').length > 0;
        pressedCodes[code] = isPressed && !isButton;
        if (isButton) {
            return;
        }
        var pressedSides = [];
        $.each(pressedCodes, (code, isPressed) => {
            var codesToMove = {
                37: 'left',
                38: 'top',
                39: 'right',
                40: 'bottom'
            };
            var side = codesToMove[code];
            isPressed && side && pressedSides.push(side);
        });
        if (player.dead || player.won || !isPressed) {
            return;
        }
        $.each(pressedSides, (i, side) => {
            moveBySide($player, side, player.step, true);
        });
        if (pressedSides.length) {
            rotateToSide($player, pressedSides);
            fitToViewport($player);
            checkIntersections();
            checkCompletion();
        }

        var shot = code === 32; // space
        shot && shoot();

        rotateEnemies();
    });
});

function resizeField() {
    var previous = { ...viewport };
    viewport.width = $(window).width();
    viewport.height = $(window).height();
    // Complete a pending turn before measuring the resized player's position.
    stopPlayerTurn();
    $('#player, .item, .enemy').each((i, elem) => {
        var $elem = $(elem);
        $elem.css({
            left: parseFloat($elem.css('left')) * viewport.width / previous.width,
            top: parseFloat($elem.css('top')) * viewport.height / previous.height
        });
        fitToViewport($elem);
    });
    rotateEnemies();
}

function fitToViewport($elem) {
    var width = $elem.width();
    var height = $elem.height();
    // Enemies turn on every move; the player must also be able to reach edge gems.
    var angle = $elem.is('#player') ? getRotateDegree($elem) * Math.PI / 180 : 0;
    var rotatedWidth = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle));
    var rotatedHeight = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle));
    if ($elem.is('.enemy')) {
        rotatedWidth = rotatedHeight = Math.hypot(width, height);
    }
    var marginX = Math.max(0, (rotatedWidth - width) / 2);
    var marginY = Math.max(0, (rotatedHeight - height) / 2);
    var left = Math.max(marginX, Math.min(parseFloat($elem.css('left')), viewport.width - width - marginX));
    var top = Math.max(marginY, Math.min(parseFloat($elem.css('top')), viewport.height - height - marginY));
    if ($elem.is('#player')) {
        var turnMarginX = (Math.hypot(width, height) - width) / 2;
        var turnMarginY = (Math.hypot(width, height) - height) / 2;
        if (left < turnMarginX || left + width + turnMarginX > viewport.width ||
            top < turnMarginY || top + height + turnMarginY > viewport.height) {
            // Snap edge turns so their intermediate angles cannot leave the field.
            stopPlayerTurn();
        }
    }
    $elem.css({ left, top });
}

function stopPlayerTurn() {
    $player.removeClass('animated-transform');
    $player[0].getAnimations().forEach(animation => animation.cancel());
}

function distributeItems() {
    var html = '';
    for (var i = 0; i < itemsCount; i++) {
        var type = getRandomInt(1, 3);
        var left = getRandomInt(0, viewport.width - 30); // 30 - width of item
        var top = getRandomInt(30, viewport.height - 30); // 30 - height of item
        html += '<div class="item" data-id="' + (i + 1) + '" data-type="' + type + '" style="left: ' + left + 'px; top: ' + top + 'px;"></div>';
    }
    $('#field').append(html);
    $('#items-scale-text').html(0 + ' / ' + itemsCount);
}

function distributeEnemies() {
    var html = '';
    for (var i = 0; i < enemiesCount; i++) {
        var type = getRandomInt(1, 3);
        var left = getRandomInt(0, viewport.width - 70); // 70 - width of enemy
        var top = getRandomInt(30, viewport.height - 70); // 70 - height of enemy
        html += '<div class="enemy" data-id="' + (i + 1) + '" data-type="' + type + '" style="left: ' + left + 'px; top: ' + top + 'px;"></div>';
    }
    $('#field').append(html);
    $('#player-health-scale-text').html(player.health.remain + ' / ' + player.health.total);
    rotateEnemies();
    // $('#enemies-scale-text').html(0 + ' / ' + enemiesCount);
}

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getClosestDegrees(curDegree, side) {
    var map = {
        top: 0,
        left: -90,
        right: 90,
        bottom: 180,
        'top-left': -45,
        'top-right': 45,
        'bottom-left': -135,
        'bottom-right': 135
    };
    var newDegree = map[side];
    var diff = newDegree - curDegree;
    if (diff > 180) {
        newDegree = curDegree + (diff - 360);
    }
    if (diff < -180) {
        newDegree = curDegree + (diff + 360);
    }
    return newDegree;
}

function getRotateDegree($elem) {
    return parseInt($elem[0].style.transform.replace('rotate(', '').replace('deg)', '')) || 0;
}

function rotateToSide($elem, sides) {
    var sidesOrder = {
        top: 0,
        left: 1,
        right: 1,
        bottom: 0
    };
    var side = sides.sort((a, b) =>  sidesOrder[a] - sidesOrder[b]).join('-');
    $elem.data('side', side);
    var curDegree = getRotateDegree($elem);
    var newDegree = getClosestDegrees(curDegree, side);
    if (newDegree !== curDegree) {
        $elem.addClass('animated-transform');
        $elem[0].style.transform = 'rotate(' + newDegree + 'deg)';
    }
    if (Math.abs(newDegree) > 360) {
        setTimeout(() => {
            newDegree = newDegree % 360;
            $elem.removeClass('animated-transform');
            $elem[0].style.transform = 'rotate(' + newDegree + 'deg)';
        }, 500); // wait for animation end
    }
}

var time = {}

function startCountTime(type) {
    if (!time[type]) {
        time[type] = {total: 0};
    }
    time[type].lastStarted = Date.now();
}

function stopCountTime(type) {
    var diff = Date.now() - time[type].lastStarted;
    time[type].total += diff;
    console.clear();
    console.table(time);
}

function moveBySide($elem, side, step, checkViewport) {
    var left = parseInt($elem.css('left'));
    var top = parseInt($elem.css('top'));
    var right = left + $elem.width();
    var bottom = top + $elem.height();
    if (side === 'left' && (!checkViewport || left - step >= 0)) {
        $elem.css('left', left - step);
    }
    if (side === 'top' && (!checkViewport || top - step >= 0)) {
        $elem.css('top', top - step);
    }
    if (side === 'right' && (!checkViewport || right + step <= viewport.width)) {
        $elem.css('left', left + step);
    }
    if (side === 'bottom' && (!checkViewport || bottom + step <= viewport.height)) {
        $elem.css('top', top + step);
    }
};

function checkIntersections() {
    // startCountTime('checkIntersections-items');
    checkIntersection($player, $('.item'), (itemElem) => {
        $(itemElem).remove();
        var collected = itemsCount - $('.item').length;
        $('#items-scale-text').html(collected + ' / ' + itemsCount);
        $('#items-scale-fill').width((100 * collected / itemsCount) + '%');
    });
    // stopCountTime('checkIntersections-items');

    // startCountTime('checkIntersections-enemies');
    checkIntersection($player, $('.enemy'), (enemyElem) => {
        $(enemyElem).addClass('hitting');
        player.health.remain = Math.max(player.health.remain - enemy.hit.force, 0);
        $('#player-health-scale-text').html(player.health.remain + ' / ' + player.health.total);
        $('#player-health-scale-fill').width((100 * player.health.remain / player.health.total) + '%');
    }, (enemyElem) => {
        $(enemyElem).removeClass('hitting');
    });
    // stopCountTime('checkIntersections-enemies');
}

function checkIntersection($main, $elems, intCallback, notIntCallback) {
    var mainRect = $main[0].getBoundingClientRect();
    $elems.each((i, elem) => {
        var itemRect = elem.getBoundingClientRect();
        var isIntersects = !(
            itemRect.left > mainRect.right || 
            itemRect.right < mainRect.left || 
            itemRect.top > mainRect.bottom || 
            itemRect.bottom < mainRect.top
        );
        if (isIntersects) {
            intCallback && intCallback(elem);
        }
        else {
            notIntCallback && notIntCallback(elem);
        }
    });
}

function checkCompletion() {
    if (player.health.remain === 0) {
        player.dead = true;
        $player.addClass('finished dead');
        $('#game-help').prop('hidden', true);
        $('#game-over').prop('hidden', false);
    } else if ($('.item').length === 0) {
        player.won = true;
        $player.addClass('finished won');
        $('#game-help').prop('hidden', true);
        $('#game-won').prop('hidden', false);
    }
}

function shoot() {
    var playerCenterCoords = getPlayerCenterCoords();
    var left = playerCenterCoords.x - 50 / 2; // 50 - width of fire
    var top = playerCenterCoords.y - 50 / 2; // 50 - height of fire
    var degree = getRotateDegree($player); // just for future, if fire sprite will be oriented
    var side = $player.data('side') || 'top';
    $('#field').append('<div class="fire"></div>');
    var $fire = $('.fire:last').css({left: left, top: top, transform: 'rotate(' + degree + 'deg)'});
    $fire.animate({opacity: 1}, 200);
    var step = 500;
    moveFireBySide($fire, side, step);
    var i1 = setInterval(() => {
        moveFireBySide($fire, side, step);
        // check for exit from screen
        checkIntersection($fire, $('body'), null, () => {
            hideFire($fire);
        });
    }, 1000);
    var i2 = setInterval(() => {
        // check for collision with enemy
        checkIntersection($fire, $('.enemy'), (enemyElem) => {
            hideFire($fire);
            $(enemyElem).remove();
        });
    }, 1000 / 24);
    $fire.data({i1: i1, i2: i2});
}

function hideFire($fire) {
    moveFireBySide($fire, '', 0); // stop
    $fire.css({transform: 'scale(2)', opacity: 0});
    setTimeout(() => {
        $fire.remove();
    }, 1000);
    clearInterval($fire.data('i1'));
    clearInterval($fire.data('i2'));
}

function moveFireBySide($elem, side, step) {
    if (!side || !step) {
        var pos = $elem.position();
        $elem.css({left: pos.left, top: pos.top});
        return;
    }
    var sides = side.split('-');
    $.each(sides, (i, side) => {
        moveBySide($elem, side, step);
    });
}

function getPlayerCenterCoords() {
    var playerRect = $player[0].getBoundingClientRect();
    return getCenterCoords(playerRect);
}

function getCenterCoords(rect) {
    return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
}

function rotateEnemies() {
    var playerCenterCoords = getPlayerCenterCoords();
    $('.enemy').each((i, enemyElem) => {
        var enemyRect = enemyElem.getBoundingClientRect();
        var enemyCenterCoords = getCenterCoords(enemyRect);
        var dx = playerCenterCoords.x - enemyCenterCoords.x;
        var dy = playerCenterCoords.y - enemyCenterCoords.y;
        var rads = Math.atan(dy / dx);
        var degs = rads * 180 / Math.PI;
        var startDegs = dx > 0 ? -90 : 90;
        enemyElem.style.transform = 'rotate(' + (startDegs + degs) + 'deg)';
    });
}
