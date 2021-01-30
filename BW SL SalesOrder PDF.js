/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/record','N/file','N/render','N/xml', 'N/search', './lib/2.0/MSA_MathUtility'],
	
function(record,file,render,xml, search, mathUtility) {
	const _itemTypeInventory = "InvtPart";
	const _ItemTypeGroup = 'Group';
	const _ItemTypeEndGroup = 'EndGroup';
	const _ItemTypeMarkup = 'Markup';
	const _ItemTypeDiscount = 'Discount';
	const _ItemTypeSubtotal = 'Subtotal';
	const _ItemTypeDescription = 'Description';
	const _ItemTypeService = 'Service';
	
	const _SALES_TYPE_NEW = 1; // New
	const _SALES_TYPE_POV = 5; // POV
	
	const _CONTACT_ROLE_ORDER_APPROVER = 1;
	const _CONTACT_ROLE_AMC_RENEWAL = 2;
	
	const _RENEWAL_STATUS_RENEWAL = 2;
	const _RENEWAL_STATUS_EXPANSION = 4;
	
	const _MPG_PERPETUAL = 5;
    /**
     * Definition of the Suitelet script trigger point.
     *
     * @param {Object} context
     * @param {ServerRequest} context.request - Encapsulation of the incoming request
     * @param {ServerResponse} context.response - Encapsulation of the Suitelet response
     * @Since 2015.2
     */
    function onRequest(context) {
    	var request = context.request;
    	var response = context.response;
    	var params = request.parameters;
    	
    	var recordId= (params['custparam_recId']);
    	var recType = (params['custparam_recType']).toLowerCase();
    	
    	var jsonParam ={};
    	jsonParam.record ={};
    	jsonParam.record.items= [];
    	
    	var rec = record.load({type: recType, id: recordId});
    	
    	// Get the Subsidiary Record.
    	var subsidiaryRec = null;
    	var subsidiaryId = rec.getValue({fieldId:'subsidiary'});
    	if(subsidiaryId) {
    		subsidiaryRec = record.load({type:record.Type.SUBSIDIARY, id:subsidiaryId});
    	}
    	
    	var lineCount = rec.getLineCount({sublistId: 'item'});
    	var itemIds = [];
    	for (var i=0; i<lineCount; i++) {
    		var itemId = rec.getSublistValue({sublistId: 'item', fieldId: 'item', line: i});	
    		itemIds.push(itemId);
    	}
    	log.debug('itemIds = ', itemIds);
    	
    	var displayNameByItemId = {};
    	var displayTransByItemId = {};
    	var uomByItemId ={};
    	var mpgByItemId={};
    	var expInfo={};
    	if(itemIds.length > 0) { // If Items found then get the Display Name for Each Item
    		var itemSearch = search.create({type:search.Type.ITEM, 
    			filters:[{name:'internalid', operator:search.Operator.ANYOF, values:itemIds}], 
    			columns:[{name:'displayname'},
    			         {name:'custitem_msa_displayname_translated'},
    			         {name:'custitemmpg'},
    			         {name:'custitem_msa_sales_unit'}]});
    		var itemSRs = itemSearch.run();
    		if(itemSRs) {
    			var resultIndex = 0; // resultIndex points to record starting current resultSet in the entire results array 
    			var resultStep = 1000; // Number of records returned in one step (maximum is 1000)
    			var resultSet; // temporary variable used to store the result set
    			do {
    				// fetch one result set
    			    resultSet = itemSRs.getRange(resultIndex, resultIndex + resultStep); // API Governance 10
    			    if(resultSet) {
    			    	for(var i=0; i<resultSet.length; i++) {
    			    		var objResult = resultSet[i];
    			    		
    			    		var itemId = objResult.id;
    			    		var displayName = objResult.getValue({name:'displayname'});
    			    		displayNameByItemId[itemId] = displayName;
    			    		
    			    		var displayTransName = objResult.getValue({name:'custitem_msa_displayname_translated'});
    			    		displayTransByItemId[itemId] = displayTransName;
    			    		
    			    		var mpg = objResult.getText({name:'custitemmpg'});
    			    		mpgByItemId[itemId] = mpg;
    			    		
    			    		var uom = objResult.getText({name:'custitem_msa_sales_unit'});
    			    		uomByItemId[itemId] = uom;
    			    	}
    			    	// increase pointer
    	    		    resultIndex = resultIndex + resultStep;

    	    		    // process or log the results
    	    		    log.debug('resultSet returned for itemSRs = ', resultSet.length + ' records returned');
    			    }
    			} while(resultSet && resultSet.length >= 1000);
    		}
    	}
    	
    	log.debug ('uomByItemId',uomByItemId);
    	log.debug('displayNameByItemId = ', displayNameByItemId);
    	log.debug('displayTransByItemId = ', displayTransByItemId);
    	log.debug('mpgByItemId',mpgByItemId);
    	
    	var entityId = rec.getValue({fieldId:'entity'});
    	log.debug ('entityId',entityId);
    	
    	var contact = (search.create({type:search.Type.CONTACT, 
			filters:[{name:'custentity_msa_contact_role', operator:search.Operator.ANYOF, values:_CONTACT_ROLE_ORDER_APPROVER},
			         {name:'company', operator:search.Operator.ANYOF, values: entityId}], 
			columns:[{name:'entityid'}]})).run().getRange(0, 1);
    	var contactName= contact && contact.length > 0 ? contact[0].getValue({name:'entityid'}) : '';
    	log.debug ('contactName',contactName);
    	jsonParam.record.contactName= contactName;
    	
    	var lines = [];
    	var expansionLinesByItemId = {};
    	var isGroupFound = false;
    	var itemGroupStartIndex = -1;
    	var currentGroupInfo = null;
    	for (var i=0; i<lineCount; i++) {
    		var itemType = rec.getSublistValue({sublistId: 'item', fieldId: 'itemtype', line: i});
    		var itemId = rec.getSublistValue({sublistId: 'item', fieldId: 'item', line: i});
    		var item = rec.getSublistText({sublistId: 'item', fieldId: 'item', line: i}); // This field is List / Record type, so we use text to get the Text Value of the Field
			var des = rec.getSublistValue({sublistId: 'item', fieldId: 'description', line: i}); // This field is Text Area field, so we get the Value of the field.
			var qty = rec.getSublistValue({sublistId: 'item', fieldId: 'quantity', line: i}); // This field is Numeric field, So we get the value of the field which returns numeric value
			var dur = rec.getSublistValue({sublistId: 'item', fieldId: 'custcol_msa_licence_duration', line: i});
			var unit = rec.getSublistText({sublistId: 'item', fieldId: 'units', line: i});
			var taxrate = rec.getSublistValue({sublistId: 'item', fieldId: 'taxrate1', line: i});
			var price = rec.getSublistValue({sublistId: 'item', fieldId: 'custcol_msa_bundle_price', line: i});
			var externalDescription = rec.getSublistValue({sublistId: 'item', fieldId: 'custcol_msa_external_description', line: i});
			var displayName = displayNameByItemId[itemId];
			var displayTransName = displayTransByItemId[itemId];
			var uom = uomByItemId[itemId];
			var mpg = mpgByItemId[itemId];
			var lineAmount = rec.getSublistValue({sublistId: 'item', fieldId: 'amount', line: i});
			var renewalStatus = rec.getSublistValue({sublistId: 'item', fieldId: 'custcolbw_new_renewal', line: i});
			log.debug('itemType = '+itemType, 'displayName = '+displayName);

    		if(itemType == 'Group') {
    			var amount = price*qty*dur;

    			var taxrate = rec.getSublistValue({sublistId: 'item', fieldId: 'taxrate1', line: i+1});
    			
    			isGroupFound = true;
    			currentGroupInfo = {'itemIden':itemId, 'productName':displayName, 'description':externalDescription ? externalDescription : des, 'quantity':qty, 
    					'duration': dur, 'translatedName': externalDescription ? externalDescription : displayTransName, 'uom':uom, 'sfPrice':price,
    					'totalPrice':amount, 'taxRate':taxrate,'status':renewalStatus, 'mpGroup': mpg};
    			
    			log.debug('Group Found', currentGroupInfo);
    		}  
	    	
    		if(!isGroupFound && itemType!== 'Discount') {
    			// Individual lines with out any group.
    			log.debug('Individual Line outside of any groups');
    			
    			var amount = price*qty*dur;
    				if (!amount) {
    					var amount = lineAmount;
    				}
    			var tax = taxrate/100 * amount;
    			var lineObj = {
    				'itemIden': itemId,
    				'productName': displayName,
    				'description': externalDescription ? externalDescription : des,
    				'quantity': qty,
    				'duration': dur,
    				'uom':unit,
    				'taxRate': taxrate ? taxrate.toFixed(1): '0.0', //correct
    				'taxAmount':tax ? tax.toFixed(2): '0.00',
    				'translatedName': externalDescription ? externalDescription : displayTransName,
    				'sfPrice':price ? price.toFixed(2):'0.00',
    				'totalPrice': amount ? amount.toFixed(2) : '0.00',
    				'status':renewalStatus,
    				'mpGroup': mpg
    			};
    			if(renewalStatus == _RENEWAL_STATUS_EXPANSION) {
    				var expQty = rec.getSublistValue({sublistId: 'item', fieldId: 'quantity', line: i});
    				expInfo[itemId] = (expInfo[itemId] ? parseFloat(expInfo[itemId]) : 0) + expQty;
    				
    				var expansionLines = expansionLinesByItemId[itemId] || [];
    				expansionLines.push(lineObj);
    				expansionLinesByItemId[itemId] = expansionLines;
    			} else {
        			lines.push(lineObj);
    			}
    		}
    		if(itemType == 'EndGroup') {
    			var amount = currentGroupInfo.totalPrice;
    			var taxPerc = currentGroupInfo.taxRate;
    			var tax= taxPerc/100 * amount;
    			
    			var lineObj = {  
    				'itemIden':currentGroupInfo.itemIden,
    				'productName': currentGroupInfo.productName,
    				'description': currentGroupInfo.description,
    				'quantity': currentGroupInfo.quantity, 
    				'duration': currentGroupInfo.duration,
    				'uom': currentGroupInfo.uom,
    				'taxRate': currentGroupInfo.taxRate ? currentGroupInfo.taxRate.toFixed(1): '0.0',
    				'taxAmount':tax ? tax.toFixed(2): '0.00',
    				'translatedName':currentGroupInfo.translatedName,
    				'sfPrice':currentGroupInfo.sfPrice ? currentGroupInfo.sfPrice.toFixed(2) : '0.00',
    				'totalPrice':currentGroupInfo.totalPrice ? currentGroupInfo.totalPrice.toFixed(2) : '0.00',
    				'status':currentGroupInfo.status,
    				'mpGroup': currentGroupInfo.mpGroup,
    			}
    			if(currentGroupInfo.status == _RENEWAL_STATUS_EXPANSION) {
    				var expQty = mathUtility.cParseFloat(currentGroupInfo.quantity);
    				expInfo[currentGroupInfo.itemIden] = mathUtility.cParseFloat(expInfo[currentGroupInfo.itemIden]) + expQty;
    				
    				var expansionLines = expansionLinesByItemId[currentGroupInfo.itemIden] || [];
    				expansionLines.push(lineObj);
    				expansionLinesByItemId[currentGroupInfo.itemIden] = expansionLines;
    			} else {
    				// Push this Group to Lines Array
        			lines.push(lineObj);
    			}
    			
    			isGroupFound = false; // make it false since the current Group is completed and captured into lines Array
    			currentGroupInfo = null; // make it null since the current Group is completed and captured into lines Array
    			log.debug('Group Ended');
    		}
    	}
    	log.debug('lines = ', lines); //check if status is renewal, add qty of expinfo to currentline
    	log.debug('expansionLinesByItemId = ', expansionLinesByItemId);
    	
    	var expansionItemsMerged = [];
    	for(var i=0; i<lines.length; i++) {
    		if (lines[i].status == _RENEWAL_STATUS_RENEWAL) {
    			var itemId = lines[i].itemIden;
    			var expansionQty = mathUtility.cParseFloat(expInfo[itemId]);
    			if(expansionQty > 0) {
    				lines[i].quantity = mathUtility.roundNum(mathUtility.cParseFloat(lines[i].quantity) + expansionQty, 2); // round since some time we may get 55.34561899 when add two numbers
    				// Calculate amount since Quantity is updating
    				var amount = mathUtility.roundNum(mathUtility.cParseFloat(lines[i].sfPrice) * mathUtility.cParseFloat(lines[i].quantity) * mathUtility.cParseFloat(lines[i].duration), 2);
    				lines[i].totalPrice = amount ? amount.toFixed(2) : '0.00';
    				
    				// Calculate Tax
    				var taxRate = mathUtility.cParseFloat(lines[i].taxRate);
    				var taxAmount = mathUtility.roundNum(amount * taxRate / 100, 2);
    				lines[i].taxAmount = taxAmount ? taxAmount.toFixed(2) : '0.00';
    				
    				if(expansionItemsMerged.indexOf(itemId) < 0) {
    					expansionItemsMerged.push(itemId)	
    				}
    			}
    		}
    	}
    	log.debug('Lines after adjusted expansion qty', lines);
    	
    	// Added Expansion Lines to Actual lines if no Renewal lines found.
    	for(var itemId in expansionLinesByItemId) {
    		if(expansionItemsMerged.indexOf(itemId) < 0) {
    			var expansionLines = expansionLinesByItemId[itemId];
    			lines = lines.concat(expansionLines);
    		}
    	}
    	
    	jsonParam.record.items = lines;
    	
    	var currencyId = rec.getValue({ fieldId: 'currency'});
    	var bankName = (search.create({type: 'customrecord_msa_invoice_bank_info', 
    		filters:[{name: 'custrecord_msa_invb_subsidiary',operator: 'ANYOF',values: subsidiaryId},
    		         {name: 'custrecord_msa_invb_currency',operator: 'ANYOF',values: currencyId}], 
   		columns:[{name: 'custrecord_msa_invb_bank_name_translated'}]}) ).run().getRange(0, 1);
    	var bankNameTrans= bankName && bankName.length > 0 ? bankName[0].getValue({name:'custrecord_msa_invb_bank_name_translated'}) : '';
    	
    	var bankCode = (search.create({type: 'customrecord_msa_invoice_bank_info', 
    		filters:[{name: 'custrecord_msa_invb_subsidiary',operator: 'ANYOF',values: subsidiaryId},
    		         {name: 'custrecord_msa_invb_currency',operator: 'ANYOF',values: currencyId}], 
   		columns:[{name: 'custrecord_msa_invb_bank_code_translated'}]}) ).run().getRange(0, 1);
    	var bankCodeTrans= bankCode && bankCode.length > 0 ? bankCode[0].getValue({name:'custrecord_msa_invb_bank_code_translated'}) : '';
    	
    	var bankCNAPS = (search.create({type: 'customrecord_msa_invoice_bank_info', 
    		filters:[{name: 'custrecord_msa_invb_subsidiary',operator: 'ANYOF',values: subsidiaryId},
    		         {name: 'custrecord_msa_invb_currency',operator: 'ANYOF',values: currencyId}], 
   		columns:[{name: 'custrecord_msa_invb_cnaps_translated'}]}) ).run().getRange(0, 1);
    	var CNAPS= bankCNAPS && bankCNAPS.length > 0 ? bankCNAPS[0].getValue({name:'custrecord_msa_invb_cnaps_translated'}) : '';

    	jsonParam.record.bankName= bankNameTrans;
    	jsonParam.record.bankCode= bankCodeTrans;
    	jsonParam.record.bankCNAPS= CNAPS;
    	

    	var templateId = params['custparam_template'];
    	var templateTermsP1Id = params['custparam_template_terms_p1']; // Terms & Conditions Template
    	var templateTermsP2Id = params['custparam_template_terms_p2']; // Terms & Conditions Template
    	
	    var renderer = render.create();	//encapsulate template engine object
	    renderer.addRecord({templateName:'record', record:rec});
	    // Add Subsidiary Record to Renderer to use it in .xml Template.
	    if(subsidiaryRec) {
	    	renderer.addRecord({templateName:'subsidiary', record:subsidiaryRec});
	    }
	    
	    var template = (file.load({id: templateId})).getContents();
	    template = template.replace('[[params]]', JSON.stringify(jsonParam));
	    renderer.templateContent = template;
	    
	    var templateXMLString = renderer.renderAsString();
	    templateXMLString = templateXMLString.replace(/(&\s)/g, '&#38; ');
	    
	    var xmlString = '';
	    if(templateTermsP1Id && templateTermsP2Id) {
	    	var salesType= rec.getValue({fieldId: 'custbody_msa_sales_type'});
		    log.debug('salesType =', salesType);
	    	// Chinese
		    var chineseXMLString = '';
	    	if(salesType == _SALES_TYPE_NEW || salesType == _SALES_TYPE_POV) {
	    		// Show Contract (Terms) as well.
		    	var templateTermsP1 = (file.load({id: templateTermsP1Id})).getContents();
		    	templateTermsP1 = templateTermsP1.replace('[[params]]', JSON.stringify(jsonParam));
		    	renderer.templateContent = templateTermsP1;
		    	
		    	var templateTermsP1XMLString = renderer.renderAsString();
		    	templateTermsP1XMLString = templateTermsP1XMLString.replace(/(&\s)/g, '&#38; ');
		    	
		    	var templateTermsP2 = (file.load({id: templateTermsP2Id})).getContents();
		    	templateTermsP2 = templateTermsP2.replace('[[params]]', JSON.stringify(jsonParam));
		    	renderer.templateContent = templateTermsP2;
		    	
		    	var templateTermsP2XMLString = renderer.renderAsString();
		    	templateTermsP2XMLString = templateTermsP2XMLString.replace(/(&\s)/g, '&#38; ');
		    	
		    	chineseXMLString += templateTermsP1XMLString + templateTermsP2XMLString;
	    	}
	    	xmlString = '<?xml version="1.0"?><!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd"><pdfset>' + chineseXMLString + templateXMLString + '</pdfset>';
	    } else {
	    	xmlString = templateXMLString;
	    }
	    
	    var xmlFile = render.xmlToPdf({xmlString: xmlString});  //read from rec.get value , pass field id tranid, 
	    xmlFile.name = rec.getValue({fieldId:'tranid'}) + '.pdf'; //assigning file name to file obj
	    
	    var isReturnBase64 = params['custparam_isreturnbase64'];
	    if(isReturnBase64) {
	    	response.write({
	    		output: xmlFile.getContents()
		    });
	    } else {
	    	response.writeFile({
		    	file: xmlFile
		    });	
	    }
    }
	
    return {
        onRequest: onRequest
    };
	    
});
