import {ILogger, Logger} from "durelia-logger";
import {durelia} from "durelia-framework";

export type IInjectable = IResolvableConstructor | {};

export interface IResolvedInstance {}

export interface IResolvableConstructor {
    new (...injectables: IInjectable[]): IResolvedInstance;
    prototype: IResolvedInstance;
    inject?(): Array<IInjectable>;
    /** @internal */
    __lifetime__?: "singleton" | "transient";
}

interface IDependencyTreeNode {
    classType: IResolvableConstructor;
    instance: IResolvedInstance;
    parent: IDependencyTreeNode | null;
    children: IDependencyTreeNode[];
}

export interface IDependencyInjectionContainer {
    resolve<T>(injectable: IInjectable): T;
    registerInstance(classType: IResolvableConstructor, instance: IResolvedInstance): void;
}

const isLazyInjectionPropName = "__isLazyInjection__";

/** @internal */
@inject(Logger)
@singleton
export class DependencyInjectionContainer implements IDependencyInjectionContainer {
    
    constructor(
        /** @internal */
        private logger: ILogger = new Logger()
    ) {}
    
    private readonly singletonTypeRegistry: Array<IResolvableConstructor> = [];
    private readonly singletonInstances: Array<IResolvedInstance> = [];
    
    private debug: boolean = true;

    resolve<T>(injectable: IInjectable): T {
        return this.resolveRecursive(injectable).instance as T;
    }
    
    /**
     * Registers an instance in the IoC container
     * @internal
     * @param {IResolvableConstructor} classType The class
     * @param {IResolvedInstance} instance The instance
     * @returns {void}
     * @memberOf DependencyInjectionContainer
     */
    registerInstance(classType: IResolvableConstructor, instance: IResolvedInstance): void {
        const errMsg = "Cannor register instance:";
        if (!instance) {
            throw new Error(`${errMsg} Instance is null or undefined.`);
        } else if (!classType) {
            throw new Error(`${errMsg} Type is is null or undefined.`);
        } else if (!instance.constructor || !this.isConstructorFunction(instance.constructor)) {
            throw new Error(`${errMsg} Instance is not a class instance.`);
        } else if (!this.isConstructorFunction(classType)) {
            throw new Error(`${errMsg} Type is invalid (not a class/constructor function).`);
        } else if (classType !== instance.constructor) {
            throw new Error(`${errMsg} Instance is not of the type specified.`);
        } else if (this.singletonTypeRegistry.indexOf(classType) >= 0) {
            throw new Error(`The type ${classType} is already a registered singleton.`);
        }

        this.singletonTypeRegistry.push(classType);
        this.singletonInstances.push(instance);
    }

    private isConstructorFunction(o: any): o is IResolvableConstructor {
        return !!(o && typeof o === "function" && o["prototype"]);
    }
    
    private isObjectInstance(o: any): o is object {
        return typeof o !== "function" && Object(o) === o; //&& Object.getPrototypeOf(o) === Object.prototype;
    }
    
    private isLazyInjection(o: any): o is Lazy<any> {
        return this.isObjectInstance(o) && o.constructor && o.constructor[isLazyInjectionPropName];
    }
    
    private getClassName(classType: IResolvableConstructor): string {
        let result: string;
        result = classType.prototype.constructor["name"];
        if (!result) {
            const regExp = new RegExp("^\s*function ([^\\(]+)\\s*\\(", "m");
            const matches = regExp.exec(classType.prototype.constructor.toString());
            if (matches && matches.length === 2) {
                result = matches[1];
            }
        }
        if (!result) {
            throw new Error("Unable to resolve class name");
        }
        return result;
    }

    private hasInjectionInstructions(classType: IResolvableConstructor): boolean {
        return !!(classType.inject && typeof classType.inject === "function");
    }
    
    private getInjectees(classType: IInjectable): IInjectable[] {
        if (this.isConstructorFunction(classType)) {
            if (this.hasInjectionInstructions(classType) && classType.inject) {
                return classType.inject();
            }
        }
        return [];
    }

    private isSingleton(classType: IResolvableConstructor): boolean {
        return !!(classType.__lifetime__ && classType.__lifetime__ === "singleton");
    }
    
    private getDependencyPath(node: IDependencyTreeNode | null): string {
        const parts: string[] = [];
        while (node) {
            parts.unshift(this.getClassName(node.classType));
            node = node.parent;
        }
        return parts.join("/");
    }

    private resolveRecursive(injectable: IInjectable, parent: IDependencyTreeNode | null = null): IDependencyTreeNode {
        if (this.isLazyInjection(injectable)) {
            const lazy: Lazy<any> = injectable;
            const depNode: IDependencyTreeNode = {
                parent: parent,
                classType: lazy.constructor as IResolvableConstructor,
                instance: () => lazy.resolver,
                children: <IDependencyTreeNode[]>[]
            };
            return depNode;
        } 
        else if (this.isConstructorFunction(injectable)) {
            const classType = injectable;
            
            const injectees: IInjectable[] = this.getInjectees(classType);
            const ctorArgsCount: number = classType.length;
            const depNode: IDependencyTreeNode = {
                parent: parent,
                classType: classType,
                instance: null!,
                children: <IDependencyTreeNode[]>[]
            };
            const dependencyPath = this.getDependencyPath(depNode);

            if (injectees.length !== ctorArgsCount) {
                const msg = `Durelia DependencyResolver: ${dependencyPath} FAILED. Injection argument vs constructor parameters count mismatch.`;
                this.logger.error(msg);
                throw new Error(msg);            
            }
                        
            if (this.isSingleton(classType)) {
                const idx = this.singletonTypeRegistry.indexOf(classType);
                const lifeTimeSpec = "singleton";
                if (idx >= 0) {
                    depNode.instance = this.singletonInstances[idx];
                    this.logger.debug(`Durelia DependencyResolver: ${dependencyPath} (${lifeTimeSpec}) resolved: Returned existing instance.`);
                }
                else {
                    for (const injectee of injectees) {
                        const childDep = this.resolveRecursive(injectee, depNode);
                        depNode.children.push(childDep);
                    }
                    const ctorInjectionArgs = depNode.children.map(c => c.instance);
                    try {
                        depNode.instance = new classType(...ctorInjectionArgs);
                    } catch (error) {
                        const msg = "Durelia DependencyResolver: Unable to create new instance of class.";
                        this.logger.error(msg, classType, error);
                        throw error;
                    }
                    this.singletonTypeRegistry.push(classType);
                    if (depNode.instance) {
                        this.singletonInstances.push(depNode.instance);
                    }
                    this.logger.debug(`Durelia DependencyResolver: ${dependencyPath} (${lifeTimeSpec}) resolved: Created new instance.`);
                }
            } 
            else {
                for (const injectee of injectees) {
                    const childDep = this.resolveRecursive(injectee, depNode);
                    depNode.children.push(childDep);
                }
                const ctorInjectionArgs = depNode.children.map(c => c.instance);
                try {
                    depNode.instance = new classType(...ctorInjectionArgs);
                } catch (error) {
                    const msg = "Durelia DependencyResolver: Unable to create new instance of class.";
                    this.logger.error(msg, classType, error);
                    throw error;
                }       
                const lifeTimeSpec = this.hasInjectionInstructions(classType) ? "transient" : "unspecified -> transient";
                this.logger.debug(`Durelia DependencyResolver: ${dependencyPath} (${lifeTimeSpec}) resolved: Created new instance.`);
            }
            
            return depNode;
            
        } 
        else if (this.isObjectInstance(injectable)) {
            const object = injectable;
            
            const depNode: IDependencyTreeNode = {
                classType: object.constructor ? object.constructor as IResolvableConstructor : Object,
                instance: object,
                parent: parent,
                children: []
            };

            const dependencyPath = this.getDependencyPath(depNode);
            this.logger.debug(`Durelia DependencyResolver: ${dependencyPath} resolved. Object instance injected (not a class). Returning instance.`, object);
            
            return depNode;
        } 
        else {
            // This last else code path may happen at run time even if the TypeScript types indicates that it never can.
            const neitnerClassNorObject: any = injectable;  
            
            const depNode: IDependencyTreeNode = {
                classType: neitnerClassNorObject.constructor ? neitnerClassNorObject.constructor as IResolvableConstructor : Object,
                instance: neitnerClassNorObject,
                parent: parent,
                children: []
            };
            const dependencyPath = this.getDependencyPath(depNode);
            const msg = `Durelia DependencyResolver: ${dependencyPath} FAILED. Not an object or constructor function.`;
            this.logger.error(msg, neitnerClassNorObject);
            throw new Error(msg);
        }
    }
}

/**
 * Decorates a class to specify constructor injection arguments
 * @export
 * @param {...Array<IInjectable>} args The types to inject
 * @returns {Function} The internal decorator function 
 */
export function inject(...args: Array<IInjectable>): (classType: Function) => void {
    return (classType: Function): void => {
        classType["inject"] = () => args;
    };
}

/**
 * Decorates a class to specify singleton IoC container lifetime 
 * @export
 * @param {class} classType The class
 * @returns {void}
 */
export function singleton(classType: Function): void {
    (classType as IResolvableConstructor).__lifetime__ = "singleton";
}

/**
 * Decorates a class to specify singleton IoC container lifetime 
 * @export
 * @param {class} classType The class
 * @returns {void}
 */
export function transient(classType: Function): void {
    (classType as IResolvableConstructor).__lifetime__ = "transient";
}

function isLazyInjection(classType: Function): void {
    classType[isLazyInjectionPropName] = true;
}

@isLazyInjection
export class Lazy<T extends IInjectable> {

    /**
     * Creates an instance of Lazy.
     * @internal
     * @private
     * @constructor
     * @param {T} _injectable The injectable
     * @memberOf Lazy
     */
    private constructor(private _injectable: T) {
    }

    /**
     * Use with the inject decorator to inject lazy factory function instead of instance.
     * @static
     * @template T
     * @param {T} injectable The injectable
     * @returns {Lazy<T>} The lazy instances
     * @memberOf Lazy
     */
    static of<T extends IInjectable>(injectable: T): Lazy<T> {
        return new Lazy<T>(injectable);
    }

    get resolver(): IResolvedInstance {
        return durelia.container.resolve(this._injectable);
    }
}

