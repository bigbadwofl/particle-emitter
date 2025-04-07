import { Point } from 'pixi.js';
import { Particle } from '../Particle';
import { normalize, rotatePoint, scaleBy, SimpleEase, EaseSegment, generateEase } from '../ParticleUtils';
import { PropertyList } from '../PropertyList';
import { PropertyNode, ValueList } from '../PropertyNode';
import { BehaviorOrder, IEmitterBehavior } from './Behaviors';
import { BehaviorEditorConfig } from './editor/Types';

/**
 * Interface for a speed range
 */
interface SpeedRange {
    /**
     * Minimum speed value
     */
    min: number;
    /**
     * Maximum speed value
     */
    max: number;
}

/**
 * Interface for a speed pick list entry
 */
interface SpeedPickListEntry {
    /**
     * Speed range to pick from - can be either an object with min/max or an array [min, max]
     */
    value: SpeedRange | number[];
    /**
     * The percentage time of the particle's lifespan that this step happens at.
     * Values are between 0 and 1, inclusive.
     */
    time: number;
}

/**
 * Configuration for a pick list of speed ranges
 */
interface SpeedPickList {
    /**
     * The ordered list of speed ranges to pick from at different times
     */
    list: SpeedPickListEntry[];
    /**
     * If the list is stepped. Stepped lists don't determine any in-between values, instead sticking with each value
     * until its time runs out.
     */
    isStepped?: boolean;
    /**
     * Easing that should be applied to this list, in order to alter how quickly the steps progress.
     */
    ease?: SimpleEase | EaseSegment[];
}

/**
 * A Movement behavior that uses an interpolated or stepped list of values for a particles speed at any given moment.
 * Movement direction is controlled by the particle's starting rotation.
 * Can also use a pickList format where a random value is chosen from a range for each particle at each time point.
 *
 * Example config:
 * ```javascript
 * {
 *     type: 'moveSpeed',
 *     config: {
 *          speed: {
 *              list: [{value: 10, time: 0}, {value: 100, time: 0.25}, {value: 0, time: 1}],
 *          },
 *          minMult: 0.8
 *     }
 * }
 * ```
 * 
 * Example config with pickSpeed:
 * ```javascript
 * {
 *     type: 'moveSpeed',
 *     config: {
 *          pickSpeed: {
 *              list: [
 *                  {value: { min: 5, max: 10 }, time: 0},
 *                  {value: { min: 1, max: 5 }, time: 1}
 *              ]
 *          }
 *     }
 * }
 * ```
 */
export class SpeedBehavior implements IEmitterBehavior
{
    public static type = 'moveSpeed';
    public static editorConfig: BehaviorEditorConfig = null;

    public order = BehaviorOrder.Late;
    private list: PropertyList<number>;
    private minMult: number;
    private usePickList: boolean;
    private pickList: SpeedPickListEntry[];
    private isStepped: boolean;
    private ease: SimpleEase;
    private particleSpeedMap: Map<Particle, PropertyList<number>>;

    constructor(config: {
        /**
         * Speed of the particles in world units/second, with a minimum value of 0
         */
        speed?: ValueList<number>;
        /**
         * A value between minimum speed multipler and 1 is randomly
         * generated and multiplied with each speed value to generate the actual speed for each particle.
         */
        minMult?: number;
        /**
         * Pick speed configuration for random speed values within ranges
         */
        pickSpeed?: SpeedPickList;
    })
    {
        this.particleSpeedMap = new Map();
        
        // Check if we're using the pickList format
        if (config.pickSpeed) {
            this.usePickList = true;
            this.pickList = config.pickSpeed.list;
            this.isStepped = !!config.pickSpeed.isStepped;
            this.ease = config.pickSpeed.ease ? 
                (typeof config.pickSpeed.ease === 'function' ? config.pickSpeed.ease : generateEase(config.pickSpeed.ease)) : 
                null;
            
            // Initialize a default list for initialization
            if (this.pickList.length > 0) {
                this.list = new PropertyList<number>(false);
                const firstEntry = this.pickList[0];
                let min: number, max: number;
                
                // Handle both object format and array format
                if (Array.isArray(firstEntry.value)) {
                    min = firstEntry.value[0];
                    max = firstEntry.value[1];
                } else {
                    min = firstEntry.value.min;
                    max = firstEntry.value.max;
                }
                
                const firstValue = (Math.random() * (max - min)) + min;
                const node = new PropertyNode<number>(firstValue, 0);
                this.list.reset(node);
            }
            
            this.minMult = 1; // Not used with pickList
        } else {
            // Original format
            this.usePickList = false;
            this.list = new PropertyList<number>(false);
            if (config.speed) {
                this.list.reset(PropertyNode.createList(config.speed));
            } else {
                // Default to a static speed of 0 if neither speed nor pickSpeed is provided
                const node = new PropertyNode<number>(0, 0);
                this.list.reset(node);
            }
            this.minMult = config.minMult ?? 1;
        }
    }

    initParticles(first: Particle): void
    {
        let next = first;

        if (this.usePickList) {
            while (next) {
                // Create a unique speed list for each particle
                this.assignRandomSpeedList(next);
                
                // Set initial velocity
                const speedList = this.particleSpeedMap.get(next);
                const speed = speedList.first.value;
                
                if (!next.config.velocity) {
                    next.config.velocity = new Point(speed, 0);
                } else {
                    (next.config.velocity as Point).set(speed, 0);
                }
                
                rotatePoint(next.rotation, next.config.velocity);
                
                next = next.next;
            }
        } else {
            // Original behavior
            while (next) {
                const mult = (Math.random() * (1 - this.minMult)) + this.minMult;

                next.config.speedMult = mult;
                if (!next.config.velocity) {
                    next.config.velocity = new Point(this.list.first.value * mult, 0);
                } else {
                    (next.config.velocity as Point).set(this.list.first.value * mult, 0);
                }

                rotatePoint(next.rotation, next.config.velocity);

                next = next.next;
            }
        }
    }

    updateParticle(particle: Particle, deltaSec: number): void
    {
        let speed: number;
        
        if (this.usePickList) {
            const speedList = this.particleSpeedMap.get(particle);
            if (speedList) {
                speed = speedList.interpolate(particle.agePercent);
            } else {
                speed = 0;
            }
        } else {
            speed = this.list.interpolate(particle.agePercent) * particle.config.speedMult;
        }
        
        const vel = particle.config.velocity;

        normalize(vel);
        scaleBy(vel, speed);
        particle.x += vel.x * deltaSec;
        particle.y += vel.y * deltaSec;
    }
    
    /**
     * Assigns a random speed list to a particle from the pickList
     */
    private assignRandomSpeedList(particle: Particle): void {
        if (!this.pickList || this.pickList.length === 0) return;
        
        // Create a new PropertyList for this particle
        const speedList = new PropertyList<number>(false);
        
        // Create the first node
        const firstEntry = this.pickList[0];
        let min: number, max: number;
        
        // Handle both object format and array format
        if (Array.isArray(firstEntry.value)) {
            min = firstEntry.value[0];
            max = firstEntry.value[1];
        } else {
            min = firstEntry.value.min;
            max = firstEntry.value.max;
        }
        
        const firstValue = (Math.random() * (max - min)) + min;
        const firstNode = new PropertyNode<number>(firstValue, firstEntry.time, this.ease);
        firstNode.isStepped = this.isStepped;
        
        let currentNode = firstNode;
        
        // Create nodes for each time point, picking a random value from each range
        for (let i = 1; i < this.pickList.length; i++) {
            const entry = this.pickList[i];
            let min: number, max: number;
            
            // Handle both object format and array format
            if (Array.isArray(entry.value)) {
                min = entry.value[0];
                max = entry.value[1];
            } else {
                min = entry.value.min;
                max = entry.value.max;
            }
            
            const value = (Math.random() * (max - min)) + min;
            
            currentNode.next = new PropertyNode<number>(value, entry.time);
            currentNode = currentNode.next;
        }
        
        // Set up the property list
        speedList.reset(firstNode);
        
        // Store it in the map
        this.particleSpeedMap.set(particle, speedList);
    }
}

/**
 * A Movement behavior that uses a randomly picked constant speed throughout a particle's lifetime.
 * Movement direction is controlled by the particle's starting rotation.
 *
 * Example config:
 * ```javascript
 * {
 *     type: 'moveSpeedStatic',
 *     config: {
 *          min: 100,
 *          max: 150
 *     }
 * }
 * ```
 */
export class StaticSpeedBehavior implements IEmitterBehavior
{
    public static type = 'moveSpeedStatic';
    public static editorConfig: BehaviorEditorConfig = null;

    public order = BehaviorOrder.Late;
    private min: number;
    private max: number;
    constructor(config: {
        /**
         * Minimum speed when initializing the particle.
         */
        min: number;
        /**
         * Maximum speed when initializing the particle.
         */
        max: number;
    })
    {
        this.min = config.min;
        this.max = config.max;
    }

    initParticles(first: Particle): void
    {
        let next = first;

        while (next)
        {
            const speed = (Math.random() * (this.max - this.min)) + this.min;

            if (!next.config.velocity)
            {
                next.config.velocity = new Point(speed, 0);
            }
            else
            {
                (next.config.velocity as Point).set(speed, 0);
            }

            rotatePoint(next.rotation, next.config.velocity);

            next = next.next;
        }
    }

    updateParticle(particle: Particle, deltaSec: number): void
    {
        const velocity = particle.config.velocity;

        particle.x += velocity.x * deltaSec;
        particle.y += velocity.y * deltaSec;
    }
}
