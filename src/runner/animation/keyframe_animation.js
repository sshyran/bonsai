define([
  './easing',
  '../../tools',
  '../../event_emitter',
  './properties_tween'
], function(easing, tools, EventEmitter, PropertiesTween) {
  'use strict';

  var max = Math.max,
      round = Math.round,
      hasOwn = {}.hasOwnProperty;

  /**
   * Creates a KeyframeAnimation instance
   *
   * @constructor
   * @name KeyframeAnimation
   * @memberOf module:animation
   * @param {number|string} duration The duration, either as frames (number)
   *  or as seconds (e.g. '1s')
   * @param {Object} [properties] The keyframes to animate through
   * @param {Object} [options] Additional options
   * @param {String|Function} [options.easing] Easing function for each sub-animation
   *  @param {Array|Object} [options.subjects] The subject(s) (e.g. DisplayObjects) of
   *    the keyframe-animation
   *  @param {string|Object} [options.strategy='attr'] The strategy to use to
   *    get and set properties on the subjects.
   *  @param {Number|String} [options.delay=0] Delay before animation begins, in
   *   frames or seconds
   * @returns {KeyframeAnimation} An KeyframeAnimation instance
   *
   * @mixes EventEmitter
   */
  function KeyframeAnimation(clock, duration, keyframes, options) {
    options || (options = {});

    this.clock = clock;
    duration = this.duration = +duration || clock.toFrameNumber(duration);

    this._parseEventProps(options);

    this.subjects = [];
    this.initialValues = null;

    this.repeat = (options.repeat || 0) - (options.repeat % 1 || 0);
    this.delay = options.delay && clock.toFrameNumber(options.delay) || 0;
    this.isTimelineBound = options.isTimelineBound !== false;

    var easingFunc = options.easing;
    this.easing = typeof easingFunc == 'function' ?
      easingFunc : easing[easingFunc];

    this.prevFrame = 0;
    this.frame = 0;
    this.currentDelay = this.delay;
    this.currentTweenIndex = 0;

    this.keyframes = this._convertKeysToFrames(keyframes);
    // Get numerical keys (frame-numbers) and sort
    this.keys = Object.keys(this.keyframes).map(Number);
    this.keys.sort(function(a, b){ return a - b; });

    if (options.subjects) {
      this.addSubjects(options.subjects, options.strategy);
    }
  }


  KeyframeAnimation.prototype = /** @lends module:animation.KeyframeAnimation.prototype */ {

    /**
     * Parses and connects event listeners
     * passed via the options object.
     *
     * @private
     */
    _parseEventProps: function(options) {
      var propName, evtName;
      for (propName in options) {
        if (typeof options[propName] === 'function' && propName.indexOf('on') === 0) {
          evtName = propName.slice(2).toLowerCase();
          this.on(evtName, options[propName]);
          delete options[propName];
        }
      }
    },

    /**
     * Clones the KeyframeAnimation instance.
     *
     * @returns {Animation} The clone
     */
    clone: function() {
      //console.log(this.keyframes);
      return new KeyframeAnimation(this.clock, this.duration, tools.mixin({}, this.keyframes), {
        clock: this.clock,
        duration: this.duration,
        easing: this.easing,
        isTimelineBound: this.isTimelineBound
      });
    },

    /**
     * Starts or resumes an animation
     *
     * Optionally changes the subjects of the animation.
     *
     * @param {Object} [subjects]
     * @param {mixed} [strategy='attr'] The set/get strategy to use
     *   - 'attr': The 'attr' method of the object is used (for DisplayObjects)
     *   - 'prop': Normal property setting and getting is used
     *   - Object with 'set(subject, values)' and 'get(subject, propertyNames)'
     *     methods.
     */
    play: function(subjects, strategy) {

      if (this.isPlaying) {
        return this;
      }

      if (this.frame === 0) {
        this.emit('beforebegin', this);
      }

      this.emit('play', this);

      /*
        Handle the case where initial values are specified and are
        different from the subject's values. We need to set these
        `from` properties manually: (FRAME 0)
      */
      var initial = this.keyframes[0];
      if (initial && this.currentTweenIndex === 0) {
        var subjects = this.subjects;
        for (var i = 0, l = subjects.length; i < l; ++i) {
          //console.log('Applying initial to', subjects[i], initial)
          subjects[i].subject.attr(initial);
        }
      }

      this.isPlaying = true;
      this.clock.on(this.isTimelineBound ? 'advance' : 'tick', this, this.onStep);

      return this;
    },

    /**
     * Pauses an animation
     */
    pause: function() {
      this.clock.removeListener(this.isTimelineBound ? 'advance' : 'tick', this, this.onStep);
      this.emit('pause', this);
      this.isPlaying = false;
      return this;
    },

    onStep: function(_, frameNumber, timelineIsFinished) {

      if (this.currentDelay > 0 && this.currentDelay--) {
        return;
      }

      // lastFrame defaults to the current frame
      // (this'll be at the start of an animation)
      this.prevFrame = this.prevFrame || frameNumber;

      var duration = this.duration,
          frame = this.frame = this.isTimelineBound ? (
            // Increment by how many missing frames there were
            this.frame + ((frameNumber - this.prevFrame) || 1)
          ) : this.frame + 1;

      this.step(frame / duration);

      if (
        (this.isTimelineBound && timelineIsFinished) ||
        frame === duration
      ) {
        this.prevFrame = 0;
        this.currentDelay = this.delay;
        ////console.log(this, this.clock._events[':tick'].slice());
        this.reset();
        if (this.repeat === Infinity || this.repeat-- > 0) {
          //console.log('REPLAY');
          //console.log(this);
          this.play();
        } else {
          this.emit('end', this);
        }
        return;
      }
      
      this.prevFrame = frameNumber;
    },

    step: function(progress) {

      var realProgress = progress;

      if (this.easing) {
        progress = this.easing(progress);
      }

      var tweensLength = this.subjects[0].tweens.length;
      var curTween = this.subjects[0].tweens[this.currentTweenIndex];
      //console.log(progress, curTween.startProgress, curTween.endProgress, progress);
      var thisPhaseProgress = (progress - curTween.startProgress) / (curTween.endProgress-curTween.startProgress);
      //console.log('::', thisPhaseProgress)
      //console.log(thisPhaseProgress, progress, this.currentTweenIndex)

      // If there's another tween that we can move onto, we should, otherwise
      // assume that we can continue with progress > 1
      if (thisPhaseProgress > 1 && this.currentTweenIndex + 1 < tweensLength) {
        this.currentTweenIndex += 1;
        return this.step(realProgress);
      }
      //console.log('$$', this.currentTweenIndex, thisPhaseProgress);

      var subjects = this.subjects;
      for (var s = 0, sl = subjects.length; s < sl; ++s) {
        var currentSubjectTween = subjects[s].tweens[this.currentTweenIndex];
        subjects[s].subject.attr(
          currentSubjectTween.at(thisPhaseProgress)
        );
      }
    },

    /**
     * Resets an animation (so it's ready to begin again)
     */
    reset: function() {
      this.frame = 0;
      this.isPlaying = false;
      this.currentTweenIndex = 0;
      //console.log('RESETTING');
      this.clock.removeListener(this.isTimelineBound ? 'advance' : 'tick', this, this.onStep);
      return this;
    },

    /**
     * Adds a subject with given strategy to the keyframe-animation
     * @param {Object} subject The subject (usually a DisplayObject)
     * @param {mixed} [strategy='attr'] The set/get strategy to use
     *   - 'attr': The 'attr' method of the object is used (for DisplayObjects)
     *   - 'prop': Normal property setting and getting is used
     *   - Object with 'set(subject, values)' and 'get(subject)'
     *     methods.
     */
    addSubject: function(subject, strategy) {

      strategy = strategy || this.strategy || 'attr';

      var initialAttributes = tools.mixin(subject.attr(), this.keyframes[0]);

      if (!this.subjects.length) { // Not yet added subjects?
        this._fillInProperties(initialAttributes);
      }

      this.subjects.push({
        subject: subject,
        tweens: this._createTweens(initialAttributes)
      });

      //console.log('Added subject', this.subjects);

      return this;
    },

    /**
     * Adds multiple subjects with given strategy to the animation
     * @param {Array} subjects Array of subjects to add
     * @param {mixed} [strategy='attr'] The set/get strategy to use
     *   - 'attr': The 'attr' method of the object is used (for DisplayObjects)
     *   - 'prop': Normal property setting and getting is used
     *   - Object with 'set(subject, values)' and 'get(subject)'
     *     methods.
     */
    addSubjects: function(subjects, strategy) {
      var me = this;
      subjects = tools.isArray(subjects) ? subjects : [subjects];
      subjects.forEach(function(subject) {
        me.addSubject(subject, strategy);
      });
      return this;
    },

    /**
     * Removes a subject with given strategy to the animation
     * @param {Object} subject The subject to remove
     */
    removeSubject: function(subject) {
      for (var i = 0, l = this.subjects.length; i < l; ++i) {
        if (this.subjects[i].subject === subject) {
          this.subjects.splice(i, 1);
          for (var a = 0, al = this.animations.length; a < al; ++a) {
            this.animations[a].removeSubject(subject);
          }
        }
      }
    },

    /**
     * Removes a subject with given strategy to the animation
     * @param {Array} subjects Array of subjects to remove
     */
    removeSubjects: function(subjects) {
      subjects.forEach(tools.hitch(this, 'removeSubject'));
      return this;
    },

    /**
     * Creates an animation for each keyframe transition
     *
     * @private
     */
    _createTweens: function(startValues) {

      var animationDuration,
          totalDuration = 0,
          prevAnimation,
          tweens = [],
          keyframes = this.keyframes,
          prevValues = startValues;

      this.keys.forEach(function(key, i) {

        var tween;

        if (key === 0) { return; } // Don't animate to initial

        tween = new PropertiesTween(
          prevValues,
          keyframes[key]
        );

        // Calculate duration of this individual tween:
        animationDuration = key - totalDuration;

        tween.startProgress = totalDuration / this.duration;
        tween.endProgress = tween.startProgress + animationDuration / this.duration;

        totalDuration += animationDuration;

        prevValues = keyframes[key];

        tweens.push(tween);

      }, this);

      return tweens;
    },

    /**
     * Fills in properties where they are specified in one
     * keyframe but not in another
     *
     * @private
     */
    _fillInProperties: function(initialValues) {
      var lastFrame = this.duration,
          keys = this.keys,
          keyframes = this.keyframes,
          keyframe,
          properties = {};

      // Gather property names:
      keys.forEach(function(key) {

        keyframe = keyframes[key];

        for (var p in keyframe) {
          if (keyframe.hasOwnProperty(p)) {
            properties[p] = true;
          }
        }
      });

      // Fill in (missing) properties:
      tools.forEach(keys, function(frame, i) {

        var prevFrame,
            nextFrame,
            prevValue,
            nextValue,
            p;

        keyframe = keyframes[frame];

        for (p in properties) {
          if (!hasOwn.call(keyframe, p)) {

            prevFrame = getFrameOfLastDefinedProperty(p, i);
            nextFrame = getFrameOfNextDefinedProperty(p, i);
            prevValue = prevFrame && keyframes[prevFrame][p] || initialValues[p];
            nextValue = nextFrame && keyframes[nextFrame][p];

            if (prevValue == null) {
              // TODO: throw this only when the 0th frame does not specify props
              // Ideally, though, initialValues will have the value specified
              throw new Error('No initial value specified for property: ' + p);
            }

            if (nextValue == null) {
              /*
                If there is no next value then the prevValue
                must be the last occurance and thus the end-point
              */
              nextValue = prevValue;
              nextFrame = lastFrame;
            }

            var _from = {}; _from[p] = prevValue;
            var _to = {}; _to[p] = nextValue;
            keyframe[p] = new PropertiesTween(_from, _to, this.easing).at(
              (frame - prevFrame) / (nextFrame - prevFrame)
            )[p];
          }
        }
      }, this);

      function getFrameOfLastDefinedProperty(prop, keysIndex) {
        // Find last occurance of property within keyframes
        while (keysIndex--) {
          if (hasOwn.call(keyframes[keys[keysIndex]], prop)) {
            return keys[keysIndex];
          }
        }
        return null;
      }

      function getFrameOfNextDefinedProperty(prop, keysIndex) {
        // Find next occurance of property within keyframes
        for (var l = keys.length; keysIndex < l; ++keysIndex) {
          if (hasOwn.call(keyframes[keys[keysIndex]], prop)) {
            return keys[keysIndex];
          }
        }
        return null;
      }
    },

    /**
     * Process keyframes object so that each key of the object is
     * an absolute frame. Make fresh copies using `tools.mixin({},...)`
     *
     * @private
     */
    _convertKeysToFrames: function(keyframes) {
      var key, frame, maxFrame = 0;

      var clock = this.clock;
      var duration = this.duration;
      var keys = Object.keys(keyframes);
      var keyframesClean = Object.create(null);

      for (var i = 0, len = keys.length; i < len; i++) {
        key = keys[i];
        frame =
          key == +key ? key : // numerical comparision: frame number
          /^(?:from|start)$/.test(key) ? 0 : // 'from' keyword --> 0
          /^(?:to|end)$/.test(key) ? duration :
          /^\d+%$/.test(key) ? duration * parseFloat(key) / 100 :
          clock.toFrameNumber(key); // everything else
        keyframesClean[frame] = keyframes[key];
        if (frame > maxFrame) {
          maxFrame = frame;
        }
      }

      /*
        If the frame is bigger than the duration then we must
        adjust `duration` to cater for it:
      */
      if (maxFrame > this.duration) {
        this.duration = maxFrame;
      }

      return keyframesClean;
    }
  };

  tools.mixin(KeyframeAnimation.prototype, EventEmitter);

  return KeyframeAnimation;
});
