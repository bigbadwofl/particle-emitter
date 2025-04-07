import { Particle } from '../Particle';
import { PropertyList } from '../PropertyList';
import { PropertyNode, ValueList } from '../PropertyNode';
import { BehaviorOrder, IEmitterBehavior } from './Behaviors';
import { BehaviorEditorConfig } from './editor/Types';
import { SimpleEase, EaseSegment, generateEase } from '../ParticleUtils';

/**
 * Interface for a scale range
 */
interface ScaleRange {
    /**
     * Minimum scale value
     */
    min: number;
    /**
     * Maximum scale value
     */
    max: number;
}

/**
 * Interface for a scale pick list entry
 */
interface ScalePickListEntry {
    /**
     * Scale range to pick from - can be either an object with min/max or an array [min, max]
     */
    value: ScaleRange | number[];
    /**
     * The percentage time of the particle's lifespan that this step happens at.
     * Values are between 0 and 1, inclusive.
     */
    time: number;
}

/**
 * Configuration for a pick list of scale ranges
 */
interface ScalePickList {
    /**
     * The ordered list of scale ranges to pick from at different times
     */
    list: ScalePickListEntry[];
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
 * A Scale behavior that applies an interpolated or stepped list of values to the particle's x & y scale.
 * Can also use a pickList format where a random value is chosen from a range for each particle at each time point.
 *
 * Example config:
 * ```javascript
 * {
 *     type: 'scale',
 *     config: {
 *          scale: {
 *              list: [{value: 0, time: 0}, {value: 1, time: 0.25}, {value: 0, time: 1}],
 *              isStepped: true
 *          },
 *          minMult: 0.5
 *     }
 * }
 * ```
 * 
 * Example config with pickScale:
 * ```javascript
 * {
 *     type: 'scale',
 *     config: {
 *          pickScale: {
 *              list: [
 *                  {value: { min: 5, max: 10 }, time: 0},
 *                  {value: { min: 1, max: 5 }, time: 1}
 *              ]
 *          }
 *     }
 * }
 * ```
 */
export class ScaleBehavior implements IEmitterBehavior
{
    public static type = 'scale';
    public static editorConfig: BehaviorEditorConfig = null;

    public order = BehaviorOrder.Normal;
    private list: PropertyList<number>;
    private minMult: number;
    private usePickList: boolean;
    private pickList: ScalePickListEntry[];
    private isStepped: boolean;
    private ease: SimpleEase;
    private particleScaleMap: Map<Particle, PropertyList<number>>;

    constructor(config: {
        /**
         * Scale of the particles, with a minimum value of 0
         */
        scale?: ValueList<number>;
        /**
         * A value between minimum scale multipler and 1 is randomly
         * generated and multiplied with each scale value to provide the actual scale for each particle.
         */
        minMult?: number;
        /**
         * Pick scale configuration for random scale values within ranges
         */
        pickScale?: ScalePickList;
    })
    {
        this.particleScaleMap = new Map();
        
        // Check if we're using the pickList format
        if (config.pickScale) {
            this.usePickList = true;
            this.pickList = config.pickScale.list;
            this.isStepped = !!config.pickScale.isStepped;
            this.ease = config.pickScale.ease ? 
                (typeof config.pickScale.ease === 'function' ? config.pickScale.ease : generateEase(config.pickScale.ease)) : 
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
            if (config.scale) {
                this.list.reset(PropertyNode.createList(config.scale));
            } else {
                // Default to a static scale of 1 if neither scale nor pickScale is provided
                const node = new PropertyNode<number>(1, 0);
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
                // Create a unique scale list for each particle
                this.assignRandomScaleList(next);
                
                // Set initial scale
                const scaleList = this.particleScaleMap.get(next);
                const scale = scaleList.first.value;
                next.scale.x = next.scale.y = scale;
                
                next = next.next;
            }
        } else {
            // Original behavior
            while (next) {
                const mult = (Math.random() * (1 - this.minMult)) + this.minMult;

                next.config.scaleMult = mult;
                next.scale.x = next.scale.y = this.list.first.value * mult;

                next = next.next;
            }
        }
    }

    updateParticle(particle: Particle): void
    {
        if (this.usePickList) {
            const scaleList = this.particleScaleMap.get(particle);
            if (scaleList) {
                particle.scale.x = particle.scale.y = scaleList.interpolate(particle.agePercent);
            }
        } else {
            particle.scale.x = particle.scale.y = this.list.interpolate(particle.agePercent) * particle.config.scaleMult;
        }
    }
    
    /**
     * Assigns a random scale list to a particle from the pickList
     */
    private assignRandomScaleList(particle: Particle): void {
        if (!this.pickList || this.pickList.length === 0) return;
        
        // Create a new PropertyList for this particle
        const scaleList = new PropertyList<number>(false);
        
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
        scaleList.reset(firstNode);
        
        // Store it in the map
        this.particleScaleMap.set(particle, scaleList);
    }
}

/**
 * A Scale behavior that applies a randomly picked value to the particle's x & y scale at initialization.
 *
 * Example config:
 * ```javascript
 * {
 *     type: 'scaleStatic',
 *     config: {
 *         min: 0.25,
 *         max: 0.75,
 *     }
 * }
 * ```
 */
export class StaticScaleBehavior implements IEmitterBehavior
{
    public static type = 'scaleStatic';
    public static editorConfig: BehaviorEditorConfig = null;

    public order = BehaviorOrder.Normal;
    private min: number;
    private max: number;
    constructor(config: {
        /**
         * Minimum scale of the particles, with a minimum value of 0
         */
        min: number;
        /**
         * Maximum scale of the particles, with a minimum value of 0
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
            const scale = (Math.random() * (this.max - this.min)) + this.min;

            next.scale.x = next.scale.y = scale;

            next = next.next;
        }
    }
}
