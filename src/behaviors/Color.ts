import { Particle } from '../Particle';
import { Color, combineRGBComponents, hexToRGB, SimpleEase, EaseSegment, generateEase } from '../ParticleUtils';
import { PropertyList } from '../PropertyList';
import { PropertyNode, ValueList } from '../PropertyNode';
import { BehaviorOrder, IEmitterBehavior } from './Behaviors';
import { BehaviorEditorConfig } from './editor/Types';

/**
 * Interface for a color pick list entry
 */
interface ColorPickListEntry {
    /**
     * Array of colors to pick from
     */
    value: string[];
    /**
     * The percentage time of the particle's lifespan that this step happens at.
     * Values are between 0 and 1, inclusive.
     */
    time: number;
}

/**
 * Configuration for a pick list of colors
 */
interface ColorPickList {
    /**
     * The ordered list of color arrays to pick from at different times
     */
    pickList: ColorPickListEntry[];
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
 * A Color behavior that applies an interpolated or stepped list of values to the particle's tint property.
 * Can also use a pickList format where a random color is chosen for each particle at each time point.
 *
 * Example config:
 * ```javascript
 * {
 *     type: 'color',
 *     config: {
 *         color: {
 *              list: [{value: '#ff0000' time: 0}, {value: '#00ff00', time: 0.5}, {value: '#0000ff', time: 1}]
 *         },
 *     }
 * }
 * ```
 * 
 * Example config with pickList:
 * ```javascript
 * {
 *     type: 'color',
 *     config: {
 *         color: {
 *              pickList: [
 *                  {value: ['#ff0000', '#00ff00', '#0000ff'], time: 0},
 *                  {value: ['#ffff00', '#ff00ff', '#00ffff'], time: 1}
 *              ]
 *         },
 *     }
 * }
 * ```
 */
export class ColorBehavior implements IEmitterBehavior
{
    public static type = 'color';
    public static editorConfig: BehaviorEditorConfig = null;

    public order = BehaviorOrder.Normal;
    private list: PropertyList<Color>;
    private usePickList: boolean;
    private pickList: ColorPickListEntry[];
    private isStepped: boolean;
    private ease: SimpleEase;
    private particleColorMap: Map<Particle, PropertyList<Color>>;

    constructor(config: {
        /**
         * Color of the particles as 6 digit hex codes.
         */
        color: ValueList<string> | ColorPickList;
    })
    {
        this.particleColorMap = new Map();
        
        // Check if we're using the pickList format
        if ('pickList' in config.color) {
            this.usePickList = true;
            this.pickList = config.color.pickList;
            this.isStepped = !!config.color.isStepped;
            this.ease = config.color.ease ? 
                (typeof config.color.ease === 'function' ? config.color.ease : generateEase(config.color.ease)) : 
                null;
            
            // Initialize a default list for initialization
            if (this.pickList.length > 0 && this.pickList[0].value.length > 0) {
                this.list = new PropertyList<Color>(true);
                const firstColor = this.pickList[0].value[0];
                const node = new PropertyNode<Color>(hexToRGB(firstColor), 0);
                this.list.reset(node);
            }
        } else {
            // Original format
            this.usePickList = false;
            this.list = new PropertyList<Color>(true);
            this.list.reset(PropertyNode.createList(config.color));
        }
    }

    initParticles(first: Particle): void
    {
        let next = first;
        
        if (this.usePickList) {
            while (next) {
                // Create a unique color list for each particle
                this.assignRandomColorList(next);
                
                // Set initial tint
                const colorList = this.particleColorMap.get(next);
                const color = colorList.first.value;
                next.tint = combineRGBComponents(color.r, color.g, color.b);
                
                next = next.next;
            }
        } else {
            // Original behavior
            const color = this.list.first.value;
            const tint = combineRGBComponents(color.r, color.g, color.b);

            while (next) {
                next.tint = tint;
                next = next.next;
            }
        }
    }

    updateParticle(particle: Particle): void
    {
        if (this.usePickList) {
            const colorList = this.particleColorMap.get(particle);
            if (colorList) {
                particle.tint = colorList.interpolate(particle.agePercent);
            }
        } else {
            particle.tint = this.list.interpolate(particle.agePercent);
        }
    }
    
    /**
     * Assigns a random color list to a particle from the pickList
     */
    private assignRandomColorList(particle: Particle): void {
        if (!this.pickList || this.pickList.length === 0) return;
        
        // Create a new PropertyList for this particle
        const colorList = new PropertyList<Color>(true);
        
        // Create the first node
        const firstEntry = this.pickList[0];
        const randomIndex = Math.floor(Math.random() * firstEntry.value.length);
        const firstColor = firstEntry.value[randomIndex];
        const firstNode = new PropertyNode<Color>(hexToRGB(firstColor), firstEntry.time, this.ease);
        firstNode.isStepped = this.isStepped;
        
        let currentNode = firstNode;
        
        // Create nodes for each time point, picking a random color from each entry
        for (let i = 1; i < this.pickList.length; i++) {
            const entry = this.pickList[i];
            const randomIndex = Math.floor(Math.random() * entry.value.length);
            const color = entry.value[randomIndex];
            
            currentNode.next = new PropertyNode<Color>(hexToRGB(color), entry.time);
            currentNode = currentNode.next;
        }
        
        // Set up the property list
        colorList.reset(firstNode);
        
        // Store it in the map
        this.particleColorMap.set(particle, colorList);
    }
}

/**
 * A Color behavior that applies a single color to the particle's tint property at initialization.
 *
 * Example config:
 * ```javascript
 * {
 *     type: 'colorStatic',
 *     config: {
 *         color: '#ffff00',
 *     }
 * }
 * ```
 */
export class StaticColorBehavior implements IEmitterBehavior
{
    public static type = 'colorStatic';
    public static editorConfig: BehaviorEditorConfig = null;

    public order = BehaviorOrder.Normal;
    private value: number;
    constructor(config: {
        /**
         * Color of the particles as 6 digit hex codes.
         */
        color: string;
    })
    {
        let color = config.color;

        if (color.charAt(0) === '#')
        {
            color = color.substr(1);
        }
        else if (color.indexOf('0x') === 0)
        {
            color = color.substr(2);
        }

        this.value = parseInt(color, 16);
    }

    initParticles(first: Particle): void
    {
        let next = first;

        while (next)
        {
            next.tint = this.value;
            next = next.next;
        }
    }
}
