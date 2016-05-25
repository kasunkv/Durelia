import {IDialogViewModel} from "durelia-viewmodel";
import {IDialogController, DialogController} from "durelia-dialog";
import {transient, inject, observe, useView} from "durelia-framework";

export interface ITermsPartialModalModel { text: string; }

export interface ITermsPartialModalOutput { agreed: boolean; }

export interface ITermsPartialModal extends IDialogViewModel<ITermsPartialModalModel, ITermsPartialModalOutput> {}

@observe(true)
@useView("views/home/home.terms.concentmodal.html")
@inject(DialogController)
export class TermsPartialModal implements IDialogViewModel<ITermsPartialModalModel, ITermsPartialModalOutput> {
    
    constructor(
        private controller: IDialogController<ITermsPartialModalOutput>
    ) {}
    
    heading: string;
    
    text: string;
    
    activate(options: ITermsPartialModalModel): Promise<any> {
        this.text = options.text;
        this.heading = "Home Partial Modal";
        return Promise.resolve(true);
    }
        
    agree(): void {
        this.controller.ok({ agreed: true }, this);
    }
    
    disagree(): void {
        this.controller.ok({ agreed: false }, this);
    }
    
    cancel(): void {
        this.controller.cancel(null, this);
    }
    
}